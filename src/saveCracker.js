// saveCracker.js — ONE entrypoint that returns everything Provincia knows how
// to extract from a save, pulled from the AUTHORITATIVE parser for each field.
// Use this instead of reaching into saveCrackerExtras / buildingParser /
// saveOwnershipParser separately: each of those has fields that look right
// but are wrong (the canonical example: saveCrackerExtras.regionCount returns
// 4 for Carthage at turn 1 when ownerByCity correctly shows 41).
//
// Returns one consolidated object. Comments mark fields that come from the
// "right" parser when there's more than one option, plus known undercounts
// so callers don't get bitten again.

"use strict";

const fs = require("fs");
const path = require("path");

const { parseSettlements } = require("./buildingParser.js");
const { resolveCurrentOwners } = require("./saveOwnershipParser.js");
const { buildInitialOwnership } = require("./ownershipParser.js");
const { findCharacterRecords } = require("./characterParser.js");
const { parseFamilyRecords, indexFamily, attributeFamilyFactions } = require("./familyRecordParser.js");
const { parseSieges } = require("./siegeParser.js");
const { parseEventLog } = require("./eventLogParser.js");
const { parseSettlementFields } = require("./settlementFieldsParser.js");
const { findAllSettlementMarkers } = require("./buildingParser.js");
const x = require("./saveCrackerExtras.js");

// Faction attribution for character records — characters appear in a block
// preceded by a `captain_card_<faction>.tga` ASCII marker. Same trick
// save-to-descr-strat.js uses. Without this, every character is unattributed
// and per-faction counts are useless.
function findFactionMarkers(saveBuf) {
  const markers = [];
  const pattern = Buffer.from("captain_card_", "ascii");
  let p = 0;
  while ((p = saveBuf.indexOf(pattern, p)) !== -1) {
    let end = p + pattern.length;
    let faction = "";
    while (end < saveBuf.length) {
      const b = saveBuf[end];
      if (b === 0x2e) break;            // hit '.' of '.tga'
      if (b < 0x20 || b > 0x7e) break;
      faction += String.fromCharCode(b);
      end++;
    }
    if (faction.length > 0 && faction.length < 30) markers.push({ pos: p, faction });
    p += pattern.length;
  }
  return markers;
}
function assignFactions(records, factionMarkers) {
  factionMarkers.sort((a, b) => a.pos - b.pos);
  const sorted = [...records].sort((a, b) => a.offset - b.offset);
  let mi = 0, lastFaction = null;
  for (const r of sorted) {
    while (mi < factionMarkers.length && factionMarkers[mi].pos < r.offset) {
      lastFaction = factionMarkers[mi].faction;
      mi++;
    }
    r.faction = lastFaction;
  }
}

function readFactionOrderFromStrat(modDataDir) {
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }
  return [];
}

// Build {factionName: denari} map from source descr_strat — used to identify
// the player when parseFactionTreasuries' baked-in detector fails.
function readDenariFromStrat(modDataDir) {
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const out = {};
    let cur = null;
    for (const raw of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
      const line = raw.replace(/;.*$/, "").trim();
      const fm = line.match(/^faction\s+([a-z_0-9]+)/i);
      if (fm) { cur = fm[1]; continue; }
      const dm = line.match(/^denari\s+(-?\d+)/);
      if (dm && cur) out[cur] = parseInt(dm[1], 10);
    }
    return out;
  }
  return {};
}

// Read faction declaration order from descr_sm_factions.txt — this is the
// order the diplomacy matrix is indexed by (cracked 2026-05-29 from Bactria
// 3-turn diff: parser was using descr_strat order, producing phantom 15-ally
// lists when the real matrix had only 2-3 non-default cells).
function readSmFactionsOrder(modDataDir) {
  const src = path.join(modDataDir, "descr_sm_factions.txt");
  if (!fs.existsSync(src)) return [];
  const out = [];
  for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\t"([a-z_0-9]+)":/);
    if (m) out.push(m[1]);
  }
  return out;
}

// Read the `playable` block from descr_strat — list of factions selectable
// at campaign start. Cracked 2026-05-29: the save's per-faction record
// ORDER follows this list, with the player pulled to position 0.
function readPlayableFromStrat(modDataDir) {
  const candidates = [
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const text = fs.readFileSync(src, "utf8");
    const out = [];
    let inBlock = false;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "playable") { inBlock = true; continue; }
      if (inBlock && line === "end") break;
      if (!inBlock) continue;
      if (line.startsWith(";") || !line) continue;
      // Faction name (may have tab indent which `trim` already stripped)
      if (/^[a-z][a-z0-9_]*$/i.test(line)) out.push(line);
    }
    return out;
  }
  return [];
}

// Position → factionId mapping for sub=6 records in imperial-campaign saves.
// Cracked 2026-05-29 against Julii/Carthage/Antigonid/Bactria T1 ground truth.
//
// Rule:
//   pos 0     = player faction
//   pos 1     = roman_senate (a special faction always at this slot)
//   pos 2..M  = playable[1..playerIdx-1] (the "before player" run, but
//               EXCLUDING playable[0]=julii which is delayed)
//   pos M+1   = playable[0] = julii (always inserted after the before-player run)
//   pos M+2.. = playable[playerIdx+1..end] (the "after player" run)
//   pos N+1.. = non-playable factions in descrOrder
//
// Special case: when player IS julii (idx 0), playable[0] is the player itself
// so there's no separate julii insertion — order is just [julii, senate, ...rest].
function buildRecordOrderToFactionName(playable, descrOrder, playerFaction) {
  const out = [];
  out.push(playerFaction);
  out.push("roman_senate");
  const pIdx = playable.indexOf(playerFaction);
  if (pIdx === 0) {
    // Player is playable[0] (julii). Just forward from idx 1.
    for (let j = 1; j < playable.length; j++) out.push(playable[j]);
  } else if (pIdx > 0) {
    // "before player" run: playable[1..pIdx-1]
    for (let j = 1; j < pIdx; j++) out.push(playable[j]);
    // Then playable[0] = julii (delayed)
    out.push(playable[0]);
    // "after player" run: playable[pIdx+1..end]
    for (let j = pIdx + 1; j < playable.length; j++) out.push(playable[j]);
  } else {
    // Player not in playable list (shouldn't happen for imperial campaign)
    for (const f of playable) if (f !== playerFaction) out.push(f);
  }
  // Append non-playable factions in descrOrder
  const used = new Set(out);
  for (const f of descrOrder) if (!used.has(f) && !/_rebels?\d*$/.test(f) && f !== "slave") {
    out.push(f);
    used.add(f);
  }
  return out;
}

function loadNameLookup(modDataDir) {
  const candidates = [
    path.join(modDataDir, "descr_names_lookup.txt"),
    path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_names_lookup.txt"),
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    return fs.readFileSync(src, "utf8").replace(/^﻿/, "").split(/\r?\n/).map(s => s.trim());
  }
  return [];
}

function loadTraitNames(modDataDir) {
  const src = path.join(modDataDir, "export_descr_character_traits.txt");
  if (!fs.existsSync(src)) return [];
  const names = [];
  for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
    const m = line.match(/^Trait\s+(\S+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

// Public entrypoint. `modDataDir` should be the mod's data/ folder (e.g.
// "C:/RIS/RIS/data") — needed because ownership + name resolution both
// require reading descr_regions + descr_strat + descr_names_lookup.
function crackSave(saveBuf, modDataDir) {
  const t0 = Date.now();

  // ── mod-side context (small, cached on disk reads) ────────────────────
  const stratOrder    = readFactionOrderFromStrat(modDataDir);
  const nameLookup    = loadNameLookup(modDataDir);
  const traitNames    = loadTraitNames(modDataDir);
  const ownership     = buildInitialOwnership(modDataDir);
  const engineOrder   = x.deriveEngineFactionOrder(stratOrder);
  // The diplomacy matrix is indexed by descr_sm_factions order, NOT descr_strat
  // (cracked 2026-05-29 from Bactria 3-turn diff). Falls back to engineOrder.
  // KNOWN REMAINING ISSUE: matrix locator/key calibration is still off across
  // saves — Bactria T1/T2/T3 returned slightly different ally sets even though
  // user confirmed no diplomatic changes happened. So treat ally lists as
  // approximate until the locator is fixed.
  const smOrder       = readSmFactionsOrder(modDataDir);
  const diploOrder    = smOrder.length > 0 ? smOrder : engineOrder;

  // ── save-side parses, each from its CANONICAL source ──────────────────
  const header        = x.parseHeader(saveBuf);
  const treasuriesRaw = x.parseFactionTreasuries(saveBuf);
  const ownersOut     = resolveCurrentOwners(saveBuf, ownership.ownerByCity);
  const settlements   = parseSettlements(saveBuf, null, null); // returns { settlements: [...], ... }
  const diplomacy     = x.parseDiplomacyMatrix(saveBuf, diploOrder);
  const v2Chars       = x.parseCharacterExtras(saveBuf);

  // findCharacterRecords returns FULLY-PARSED records (firstName, age, role,
  // stats, traits, etc) — no separate parseCharacter call needed. The records
  // arrive without faction attribution; we tag each via the captain_card
  // marker trick used by save-to-descr-strat.
  let v1Chars = [];
  if (nameLookup.length && traitNames.length) {
    v1Chars = findCharacterRecords(saveBuf, nameLookup, traitNames, null);
    const markers = findFactionMarkers(saveBuf);
    assignFactions(v1Chars, markers);
  }

  // Full family roster — wives, daughters, young sons, dead relatives. These
  // are NOT in v1 (no trait list to anchor on); they live in a separate
  // fixed-stride family table. Cracked 2026-05-30 (see
  // src/familyRecordParser.js + rtw-sav-parser findings-family-2026-05-30).
  // Each record carries name, age, gender, alive/dead, and father/spouse/child
  // UUID links. Family HEADS (adult male generals) are in v1, not here, so we
  // resolve link names against BOTH this table and the v1 character set.
  let family = [];
  if (nameLookup.length) {
    family = parseFamilyRecords(saveBuf, nameLookup);
    // Build a uuid->name map from v1 generals so father/spouse links that
    // point at a trait-anchored head still resolve to a name.
    const extraUuidNames = new Map();
    for (const c of v1Chars) {
      const uuid = c.uuid != null ? c.uuid : c.characterUuid;
      const nm = c.fullName || c.name ||
        (c.firstName ? (c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName) : null);
      if (uuid != null && nm) extraUuidNames.set(uuid >>> 0, nm);
    }
    indexFamily(family, extraUuidNames);
    // Attribute family members to factions via the UUID link graph (they have
    // no per-faction marker of their own). Adds `.faction` to each record.
    attributeFamilyFactions(family, v1Chars);
  }
  // Per-faction family rollup (generals from v1 + their wives/children/dead
  // relatives from the family table) — what the round-trip needs to emit a
  // complete `character_record` set.
  const familyByFaction = {};
  for (const r of family) {
    if (r.faction) (familyByFaction[r.faction] ||= []).push(r);
  }

  // Active sieges — siege-ID links the besieging army to the besieged
  // settlement (cracked 2026-05-30, src/siegeParser.js). Empty when none active.
  const settlementList = (settlements && settlements.settlements) || [];
  const sieges = parseSieges(saveBuf, settlementList);

  // End-of-turn event log — sieges/captures/births/deaths/marriages/defeats,
  // each tagged with the owning faction (cracked 2026-05-31, src/eventLogParser.js).
  // diffTurn() against the previous save yields "what happened last turn".
  const events = parseEventLog(saveBuf, stratOrder);

  // Per-settlement runtime fields (population growth, income, public order,
  // governor) — cracked 2026-05-31, src/settlementFieldsParser.js. Keyed by name.
  let settlementFields = {};
  try {
    settlementFields = parseSettlementFields(saveBuf, findAllSettlementMarkers(saveBuf));
  } catch (e) { /* leave empty on failure */ }

  // ── derive per-faction rollups from the CORRECT source ────────────────
  // Region count comes from ownerByCity tally (NOT from treasuriesRaw.regionCount
  // — that field is broken: returns 4 for Carthage when truth is 41).
  const regionsByFaction = {};
  for (const [city, faction] of Object.entries(ownersOut.ownerByCity || {})) {
    (regionsByFaction[faction] ||= []).push(city);
  }
  // v1 character count per faction. KNOWN UNDERCOUNT: v1 misses wives and
  // daughters — e.g. Carthage at turn 1 = 9 generals here vs 23 family
  // members in descr_strat (9 male generals + 14 spouses/children). v2
  // finds the full 23 but has broken role/faction attribution. If you
  // need accurate family counts, this is unresolved.
  const charsByFaction = {};
  for (const c of v1Chars) {
    if (!c.faction) continue;
    (charsByFaction[c.faction] ||= []).push(c);
  }

  // Knowledge-based factionId mapping for sub=6 records (cracked 2026-05-29).
  // Each playable faction has a STABLE knowledge-size signature in the engine
  // (verified across saves: Julii=414, Carthage=173, Antigonid=161, etc).
  // We prefer this over position-based mapping because mid-turn manual saves
  // have jumbled record ordering — only end-of-turn autosaves canonicalize
  // order. Knowledge is stable regardless of save timing.
  //
  // Built empirically from T1 saves (Julii, Carthage, Antigonid, Bactria
  // crossed against source denari for uniqueness). 9 factions known; extend
  // as more saves come in.
  const KNOWLEDGE_TO_FACTION = {
    414: "romans_julii",
    250: "seleucid",
    207: "ptolemaic",
    175: "epirus",
    173: "carthage",
    161: "antigonid",
    83:  "bactria",
    69:  "cyrene",
    15:  "indians",
  };
  let playerFaction = x.identifyPlayerFactionFromSave(saveBuf, treasuriesRaw);
  // Fallback: identifyPlayer fails for some factions (verified: Bactria T1).
  // Position 0 of sub=6 records is ALWAYS the player — derive the player by
  // matching the first record's treasury or knowledgeSize against source
  // descr_strat. Treasury match works at T1; for T2+ where treasury has
  // shifted from source, knowledgeSize match is the stable fallback.
  const sub6sorted = treasuriesRaw
    .filter(t => t.knowledgeSize !== undefined)
    .sort((a, b) => a.offset - b.offset);
  if (!playerFaction && sub6sorted.length > 0) {
    const firstTreasury = sub6sorted[0].treasury;
    const firstKnowledge = sub6sorted[0].knowledgeSize;
    // Parse source denari per faction
    const denariByFaction = readDenariFromStrat(modDataDir);
    for (const [fac, den] of Object.entries(denariByFaction)) {
      if (den === firstTreasury) { playerFaction = fac; break; }
    }
    // Knowledge fallback if denari fails
    if (!playerFaction && firstKnowledge != null) {
      // Try each candidate playable faction by knowledgeSize — gathered
      // empirically from cross-save runs: each faction has a stable
      // knowledgeSize at T1 (Julii=414, Carthage=173, Antigonid=161,
      // Ptolemaic=207, Seleucid=250, Bactria=83). Match if anyone fits.
      const KNOWN_KNOWLEDGE = {
        414: "romans_julii", 173: "carthage", 161: "antigonid",
        207: "ptolemaic", 250: "seleucid", 83: "bactria",
      };
      if (KNOWN_KNOWLEDGE[firstKnowledge]) playerFaction = KNOWN_KNOWLEDGE[firstKnowledge];
    }
    // Dummies signature (cracked 2026-05-29): synthetic AI-test faction has
    // knowledgeSize=1 (it knows nothing) AND no captain banner before the first
    // NPC record (so identifyPlayerFactionFromSave returns null). The negative
    // treasury (~ -33561 in T20) is also distinctive — only dummies runs deep
    // negative because it has no settlements producing income.
    if (!playerFaction && firstKnowledge === 1 && firstTreasury < 0) {
      playerFaction = "dummies";
    }
  }
  const playable = readPlayableFromStrat(modDataDir);
  const recordOrder = playerFaction ? buildRecordOrderToFactionName(playable, stratOrder, playerFaction) : [];

  // Sort sub=6 records by offset.
  const sub6 = treasuriesRaw
    .filter(t => t.knowledgeSize !== undefined)
    .sort((a, b) => a.offset - b.offset);
  const trByName = new Map();
  // First pass: assign by knowledge signature where known. This is robust
  // against mid-turn save record jumbling.
  const claimedRecords = new Set();
  for (const r of sub6) {
    const fac = KNOWLEDGE_TO_FACTION[r.knowledgeSize];
    if (fac && !trByName.has(fac)) {
      trByName.set(fac, r);
      claimedRecords.add(r.offset);
    }
  }
  // Second pass: position-based fallback for records WITHOUT a known
  // knowledge signature. These are the smaller / less-distinguishable
  // factions (rebels, dummy, regional minors).
  const remaining = sub6.filter(r => !claimedRecords.has(r.offset));
  const remainingOrder = recordOrder.filter(name => !trByName.has(name));
  for (let i = 0; i < remaining.length && i < remainingOrder.length; i++) {
    trByName.set(remainingOrder[i], remaining[i]);
  }

  const factions = {};
  for (let i = 0; i < stratOrder.length; i++) {
    const name = stratOrder[i];
    const tr = trByName.get(name) || null;
    factions[name] = {
      factionId: i,
      treasury: tr ? tr.treasury : null,
      turnStartTreasury: tr ? tr.turnStartTreasury : null,
      netThisTurn: tr ? tr.netThisTurn : null,
      regionCount: (regionsByFaction[name] || []).length,
      regions: regionsByFaction[name] || [],
      generalCount: (charsByFaction[name] || []).length,
      diplomacy: diplomacy ? diplomacy[name] : null,
    };
  }

  // Turn number (cracked 2026-05-29). Each faction record is preceded by an
  // econ-history table whose blocks count = turn number. Use the PLAYER's
  // record. Verified on Julii T1=1, T6E=6, T7S=7, T7=7. (Falls back to null
  // if player not identified or no Type A record.)
  let turn = null;
  if (playerFaction && trByName.has(playerFaction)) {
    const r = trByName.get(playerFaction);
    for (let off = r.offset - 4; off >= r.offset - 100000 && off >= 0; off -= 4) {
      if (saveBuf.readUInt32LE(off) === off) {
        const f = [];
        for (let o = off; o + 4 <= r.offset; o += 4) f.push(saveBuf.readInt32LE(o));
        const body = f.slice(2, f.length - 1);
        if (body.length >= 23 && body.length % 23 === 0) turn = body.length / 23;
        break;
      }
    }
  }

  return {
    header,
    playerFaction,
    turn,
    factions,
    settlements: settlements && settlements.settlements ? settlements.settlements : [],
    characters: {
      v1: v1Chars,              // trait-anchored: generals/agents (name, traits, age, pos)
      v2Count: v2Chars.length,  // role/uuid records (no names)
      family,                   // FULL family roster incl. women: name, age, gender,
                                // alive, faction, fatherUuid/spouseUuid/childUuids (+resolved names)
      familyByFaction,          // family records grouped by attributed faction
    },
    diplomacy,                  // { factionName: {war, allied, hostile, trade}, _meta }
    sieges,                     // [{ besiegerArmyUuid, siegeId, turnsRemaining, targetSettlement }]
    events,                     // end-of-turn event log [{ type, faction, subject, title, body }]
    settlementFields,           // { city: { populationGrowth, income, publicOrder, governorUuid, ... } }
    ownerByCity: ownersOut.ownerByCity || {},
    _stats: {
      ms: Date.now() - t0,
      factions: Object.keys(factions).length,
      settlements: (settlements && settlements.settlements || []).length,
      v1Characters: v1Chars.length,
      v2Characters: v2Chars.length,
      familyMembers: family.length,
      familyFemales: family.filter((r) => r.gender === "female").length,
      familyAttributed: family.filter((r) => r.faction).length,
      sieges: sieges.length,
      events: events.length,
      wars: diplomacy ? diplomacy._meta?.warPairs : null,
      saveSizeBytes: saveBuf.length,
    },
  };
}

module.exports = { crackSave };
