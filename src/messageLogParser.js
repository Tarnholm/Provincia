// src/messageLogParser.js
//
// Parse lines from VFS/Local/Rome/logs/message_log.txt into structured events.
// The game emits a firehose of state-change events in this file while playing,
// which we can tail and merge with save-snapshot data. This is NOT a
// replacement for the binary save parser (the log is session-scoped and
// clears on game restart) — it's a supplement for live turn-to-turn state.
//
// UUID formats seen in the log:
//   - 32-bit hex (e.g. "a638ccd0")         — character/army id matching save parser
//   - 64-bit hex (e.g. "1e8a7a5da60")      — engine memory pointer, mostly noise
//
// We extract the 32-bit short uuid where possible, since that's what cross-
// references the save file.
//
// Pattern categories handled:
//   1. character_move   — most common, per-unit move each turn
//   2. trait_gain       — new trait at a specific level
//   3. trait_level      — level change within existing trait
//   4. trait_lose       — level decrease
//   5. ancillary_gain   — character picks up an ancillary
//   6. battle_outcome   — autoresolved battle winner/loser
//   7. army_created     — new army spawns (brigands, rebels)
//   8. settlement_damaged — riots / disasters / sieges
//   9. fleeing_army     — army routed, coords of destination

"use strict";

// Regexes anchored on the strictest distinguishing tokens first.
const RX = {
  // Captain Cambyses(a638fee0:army(a5bb19e0):parthia:general):MOVING_NORMAL:start(94,28):end(88,26)[:multi-turns left(2)]
  // The trailing loco(...) variant (EXCHANGE) is optional.
  move: /^(.+?)\(([0-9a-f]+):army\(([0-9a-f]+)\):([a-z_]+):([a-z_ ]+)\):([A-Z_]+):start\((\d+),(\d+)\):end\((\d+),(\d+)\)(?::multi-turns left\((\d+)\))?(?::loco\(([A-Z_]+)\))?$/,
  // Name(uuid) has gained a new trait(TraitName)(level-LevelName)
  traitGain: /^(.+?)\(([0-9a-f]+)\) has gained a new trait\(([^)]+)\)\(level-([^)]+)\)$/,
  // Name(uuid) has gained a level(LevelName) in trait(TraitName)
  traitLevel: /^(.+?)\(([0-9a-f]+)\) has gained a level\(([^)]+)\) in trait\(([^)]+)\)$/,
  // Name(uuid) has lost a level in trait(TraitName)
  traitLose: /^(.+?)\(([0-9a-f]+)\) has lost a level in trait\(([^)]+)\)$/,
  // Name(uuid) has gained a new ancillary(AncName)[extra garbage]
  ancillaryGain: /^(.+?)\(([0-9a-f]+)\) has gained a new ancillary\(([^)]+)\)/,
  // Name(uuid) has defeated Name(uuid) in an autoresolved battle
  battleOutcome: /^(.+?)\(([0-9a-f]+)\) has defeated (.+?)\(([0-9a-f]+)\) in an autoresolved battle/,
  // Brigands(c3554d50) army(2 units) created in region(22) at tile(102,30)
  armyCreated: /^(.+?)\(([0-9a-f]+)\) army\((\d+) units\) created in region\((\d+)\) at tile\((\d+),(\d+)\)/,
  // settlement 'Suza' damaged (riot, 968 deaths)
  settlementDamaged: /^settlement '([^']+)' damaged \(([^,]+), (\d+) deaths\)/,
  // Name(charUuid:faction) army(armyUuid) found flee tile(x,y)
  fleeTile: /^(.+?)\(([0-9a-f]+):([a-z_]+)\) army\(([0-9a-f]+)\) found flee tile\((\d+),(\d+)\)/,
  // Name(charUuid:faction:role):FLEEING:start(x,y):end(x,y)
  fleeing: /^(.+?)\(([a-z_]+):([a-z_ ]+)\):FLEEING:start\((\d+),(\d+)\):end\((\d+),(\d+)\)/,
  // Name(charUuid) army(armyUuid) is fleeing to settlement SettName(x,y)
  fleeingToSettlement: /^(.+?)\(([0-9a-f]+)\) army\(([0-9a-f]+)\) is fleeing to settlement (.+?)\((\d+),(\d+)\)/,
  // transferring unit(unitUuid) from army(fromArmyUuid) to general(Name:charUuid):army(toArmyUuid)
  unitTransfer: /^transferring unit\(([0-9a-f]+)\) from army\(([0-9a-f]+)\) to general\((.+?):([0-9a-f]+)\):army\(([0-9a-f]+)\)/,
  // Name(faction) army(armyUuid) is dead
  armyDead: /^(.+?)\(([a-z_]+)\) army\(([0-9a-f]+)\) is dead$/,
  // army(armyUuid) deleted
  armyDeleted: /^army\(([0-9a-f]+)\) deleted$/,
  // army(armyUuid) created
  armyCreatedShort: /^army\(([0-9a-f]+)\) created$/,
  // Name(charUuid:faction:role):lesser general(longUuid) removed from army in settlement or ship
  lesserGeneralRemoved: /^(.+?)\(([a-z_0-9]+):([a-z_ ]+)\):lesser general\(([0-9a-f]+)\) removed from army/,
  // character ptr(uuid) deleted
  charDeleted: /^character ptr\(([0-9a-f]+)\) deleted$/,
  // Name(charUuid:faction:role) takes command of this army(armyUuid)
  takesCommand: /^(.+?)\(([0-9a-f]+):([a-z_]+):([a-z_ ]+)\) takes command of this army\(([0-9a-f]+)\)/,
  // Name(faction:role)(uuid):death_type(DET_BATTLE | DET_DISASTER | DET_ALIVE)
  charDeath: /^(.+?)\(([a-z_]+):([a-z_ ]+)\)\(([0-9a-f]+)\):death_type\((DET_[A-Z]+)\)/,
  // Name(uuid:faction:role):DYING:start(x,y):end(x,y):death_type(DET_XXX)
  charDying: /^(.+?)\(([0-9a-f]+):([a-z_]+):([a-z_ ]+)\):DYING:start\((\d+),(\d+)\):end\((\d+),(\d+)\):death_type\((DET_[A-Z]+)\)/,
};

// Take the last 8 hex chars of a uuid — normalizes long memory-pointer UUIDs
// (e.g. 1e8a7a5da60) to the 32-bit id (a7a5da60) the save parser emits.
function shortUuid(hex) {
  if (!hex) return null;
  if (hex.length <= 8) return hex;
  return hex.slice(-8);
}

function parseLine(line) {
  if (!line || line.length < 10) return null;
  // Many lines are boot-log spam; cheap first-char filters save regex work.
  // Events all start with a word character (name or lowercase keyword).
  const c = line.charCodeAt(0);
  if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return null;

  let m;
  if ((m = RX.move.exec(line))) {
    return {
      type: "character_move",
      name: m[1].trim(),
      charUuid: shortUuid(m[2]),
      armyUuid: shortUuid(m[3]),
      faction: m[4],
      role: m[5].trim(),
      status: m[6],
      fromX: +m[7], fromY: +m[8],
      toX: +m[9], toY: +m[10],
      multiTurnsLeft: m[11] ? +m[11] : 0,
      loco: m[12] || null,
    };
  }
  if ((m = RX.traitGain.exec(line))) {
    return {
      type: "trait_gain",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      trait: m[3], level: m[4],
    };
  }
  if ((m = RX.traitLevel.exec(line))) {
    return {
      type: "trait_level",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      levelName: m[3], trait: m[4],
    };
  }
  if ((m = RX.traitLose.exec(line))) {
    return {
      type: "trait_lose",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      trait: m[3],
    };
  }
  if ((m = RX.ancillaryGain.exec(line))) {
    return {
      type: "ancillary_gain",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      ancillary: m[3],
    };
  }
  if ((m = RX.battleOutcome.exec(line))) {
    return {
      type: "battle_outcome",
      winnerName: m[1].trim(), winnerUuid: shortUuid(m[2]),
      loserName: m[3].trim(), loserUuid: shortUuid(m[4]),
    };
  }
  if ((m = RX.armyCreated.exec(line))) {
    return {
      type: "army_created",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      unitCount: +m[3], regionId: +m[4],
      x: +m[5], y: +m[6],
    };
  }
  if ((m = RX.settlementDamaged.exec(line))) {
    return {
      type: "settlement_damaged",
      settlement: m[1], cause: m[2], deaths: +m[3],
    };
  }
  if ((m = RX.fleeTile.exec(line))) {
    return {
      type: "flee_tile",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      faction: m[3], armyUuid: shortUuid(m[4]),
      x: +m[5], y: +m[6],
    };
  }
  if ((m = RX.fleeing.exec(line))) {
    return {
      type: "fleeing",
      name: m[1].trim(), faction: m[2], role: m[3].trim(),
      fromX: +m[4], fromY: +m[5], toX: +m[6], toY: +m[7],
    };
  }
  if ((m = RX.fleeingToSettlement.exec(line))) {
    return {
      type: "fleeing_to_settlement",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      armyUuid: shortUuid(m[3]),
      settlement: m[4].trim(), x: +m[5], y: +m[6],
    };
  }
  if ((m = RX.unitTransfer.exec(line))) {
    return {
      type: "unit_transfer",
      unitUuid: shortUuid(m[1]),
      fromArmyUuid: shortUuid(m[2]),
      toCommanderName: m[3].trim(),
      toCommanderUuid: shortUuid(m[4]),
      toArmyUuid: shortUuid(m[5]),
    };
  }
  if ((m = RX.armyDead.exec(line))) {
    return {
      type: "army_dead",
      commanderName: m[1].trim(),
      faction: m[2],
      armyUuid: shortUuid(m[3]),
    };
  }
  if ((m = RX.armyDeleted.exec(line))) {
    return { type: "army_deleted", armyUuid: shortUuid(m[1]) };
  }
  if ((m = RX.armyCreatedShort.exec(line))) {
    return { type: "army_created_empty", armyUuid: shortUuid(m[1]) };
  }
  if ((m = RX.lesserGeneralRemoved.exec(line))) {
    return {
      type: "lesser_general_removed",
      name: m[1].trim(), faction: m[2], role: m[3].trim(),
      charUuid: shortUuid(m[4]),
    };
  }
  if ((m = RX.charDeleted.exec(line))) {
    return { type: "character_deleted", charUuid: shortUuid(m[1]) };
  }
  if ((m = RX.takesCommand.exec(line))) {
    return {
      type: "takes_command",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      faction: m[3], role: m[4].trim(),
      armyUuid: shortUuid(m[5]),
    };
  }
  if ((m = RX.charDeath.exec(line))) {
    return {
      type: "char_death",
      name: m[1].trim(), faction: m[2], role: m[3].trim(),
      charUuid: shortUuid(m[4]),
      deathType: m[5],
      alive: m[5] === "DET_ALIVE",
    };
  }
  if ((m = RX.charDying.exec(line))) {
    return {
      type: "char_dying",
      name: m[1].trim(), charUuid: shortUuid(m[2]),
      faction: m[3], role: m[4].trim(),
      fromX: +m[5], fromY: +m[6], toX: +m[7], toY: +m[8],
      deathType: m[9],
      alive: m[9] === "DET_ALIVE",
    };
  }
  return null;
}

function parseChunk(text) {
  const events = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const ev = parseLine(line);
    if (ev) events.push(ev);
  }
  return events;
}

module.exports = { parseLine, parseChunk, shortUuid };
