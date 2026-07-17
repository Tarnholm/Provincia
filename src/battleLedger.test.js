// Unit tests for src/battleLedger.js — the per-faction battle ledger built
// from raw message_log lines / parsed events. Line fixtures are taken from
// the real 97-turn archive (calibration/logs-archive/message_log-97turns.txt),
// including the engine's newline-glomming quirks ("...battleSetting battle
// result(victory)", "...flag is setlosing army ... has been assessed").
import { describe, it, expect } from "vitest";
import { createLedger } from "./battleLedger.js";

// ── fixtures ───────────────────────────────────────────────────────────────

// Autoresolved naval battle, verbatim shapes from the archive (battle #1).
const NAVAL_BATTLE = [
  "Admiral Atheas(c20c0cf0:army(c0cfe280):slave:admiral):ATTACK:start(18,47):end(17,46)",
  "Conflict Type(Naval)",
  "***** Battle Setup Phase Started *****",
  "battle phase is BP_NONEBATTLE_ALLIANCE_STATS::clear() setting battle result to none",
  "battle general created(81d4d820 - army(c0cfe280), unit(c20ac030))adding main army(c0cfe280:slave:0 alnce0) to battle",
  "Initialising army data for battle: 1e8c0cfe280, slave",
  "battle general created(81d4d8a0 - army(a5bb1c20), unit(4de44880))adding main army(a5bb1c20:macedon:1 alnce1) to battle",
  "Initialising army data for battle: 1e8a5bb1c20, macedon",
  "post battle assessment",
  "Admiral Assandros(a5bb1c20) has defeated Admiral Atheas(c0cfe280) in an autoresolved battleSetting battle result(victory)",
  "Setting battle result(defeat)",
  "army(c0cfe280) destroy flag is setlosing army Admiral Atheas(c0cfe280:slave) has been assessed",
  "winning army Admiral Assandros(a5bb1c20:macedon) has been assessed",
  "winning main army Admiral Assandros(a5bb1c20:macedon) has been fully resolved",
  "losing main army Admiral Atheas(c0cfe280:slave) has been fully resolved",
  "finished post battle resolution",
  "Admiral Atheas(slave) army(c0cfe280) is dead",
  "army(c0cfe280) deleted",
].join("\n");

// Manual (player-fought) field battle: NO autoresolve line — winner/loser
// only appear in the assessed/resolved lines.
const FIELD_BATTLE = [
  "Captain Arsakes(aaaa1111:army(bbbb1111):parthia:general):ATTACK:start(1,1):end(2,2)",
  "Conflict Type(Normal)",
  "***** Battle Setup Phase Started *****",
  "adding main army(bbbb1111:parthia:0 alnce0) to battle",
  "adding main army(bbbb2222:scythia:1 alnce1) to battle",
  "winning army Captain Arsakes(bbbb1111:parthia) has been assessed",
  "losing army Captain Ateas(bbbb2222:scythia) has been assessed",
].join("\n");

const END_ROUND = "====================end round====================";

// ── tests ──────────────────────────────────────────────────────────────────

describe("battle classification and attribution (raw lines)", () => {
  it("classifies an autoresolved naval battle and attributes factions via army uuids", () => {
    const led = createLedger();
    const added = led.ingest(NAVAL_BATTLE);
    expect(added).toBe(2); // one battle + one army_destroyed

    const snap = led.snapshot();
    expect(snap.byFaction.macedon).toMatchObject({ fought: 1, won: 1, lost: 0, armiesDestroyed: 1, armiesLost: 0 });
    expect(snap.byFaction.slave).toMatchObject({ fought: 1, won: 0, lost: 1, armiesDestroyed: 0, armiesLost: 1 });
    expect(snap.byFaction.macedon.opponents).toEqual({ slave: 1 });
    expect(snap.byFaction.slave.opponents).toEqual({ macedon: 1 });

    // Feed is newest-first: army destruction happened after the battle.
    expect(snap.events.map(e => e.kind)).toEqual(["army_destroyed", "battle"]);
    const battle = snap.events[1];
    expect(battle.battleType).toBe("naval");
    expect(battle.winner).toBe("macedon");
    expect(battle.loser).toBe("slave");
    expect(battle.winnerName).toBe("Admiral Assandros");
    expect(battle.loserName).toBe("Admiral Atheas");
    // Kill credit: the dead army belonged to the battle's loser.
    expect(snap.events[0]).toMatchObject({ kind: "army_destroyed", faction: "slave", destroyedBy: "macedon" });
  });

  it("commits a manual battle from the assessed lines alone (no autoresolve line)", () => {
    const led = createLedger();
    expect(led.ingest(FIELD_BATTLE)).toBe(1);
    const snap = led.snapshot();
    expect(snap.byFaction.parthia).toMatchObject({ fought: 1, won: 1, lost: 0 });
    expect(snap.byFaction.scythia).toMatchObject({ fought: 1, won: 0, lost: 1 });
    expect(snap.events[0]).toMatchObject({ kind: "battle", battleType: "field", winner: "parthia", loser: "scythia" });
  });

  it("classifies a sally with its settlement, even when the sally line is glommed onto the setup marker", () => {
    const led = createLedger();
    led.ingest([
      "promoting general(Captain Selefkos:c25d6ee0) for sallying army(c38bf500) in Pella to attack army(Captain Adymos:c38bf080)***** Battle Setup Phase Started *****",
      "Conflict Type(SallyBesieger)",
      "adding main army(c38bf500:macedon:0 alnce0) to battle",
      "adding main army(c38bf080:scythia:1 alnce1) to battle",
      "winning army Captain Selefkos(c38bf500:macedon) has been assessed",
      "losing army Captain Adymos(c38bf080:scythia) has been assessed",
    ].join("\n"));
    const snap = led.snapshot();
    const battle = snap.events.find(e => e.kind === "battle");
    expect(battle).toMatchObject({ battleType: "sally", winner: "macedon", loser: "scythia", location: "Pella" });
  });
});

describe("sieges and assault captures", () => {
  const SIEGE_SEQ = [
    // faction feeder: charUuid c20c4490 → parthia
    "Captain Syrus(c20c4490:army(cccc1111):parthia:general):MOVING_NORMAL:start(1,1):end(2,2)",
    "siege by Captain Syrus(c20c4490) on Bactria(115,40) has begun",
    "Conflict Type(Siege)",
    "***** Battle Setup Phase Started *****",
    "adding main army(cccc1111:parthia:0 alnce0) to battle",
    "adding main army(cccc2222:slave:1 alnce1) to battle",
    "winning army Captain Syrus(cccc1111:parthia) has been assessed",
    "losing army Captain Guard(cccc2222:slave) has been assessed",
    // The engine reports ONE capture three ways — all must collapse to one.
    "faction(slave) surrenders Bactria to faction(parthia). Reason - SUCCESSFUL_ASSAULT",
    "faction(slave) surrenders Bactria to faction(parthia). Reason - CAPTURED",
    "faction(parthia) captures Bactria from slave. Reason - CAPTURED",
  ].join("\n");

  it("counts the siege once, tags the battle as a siege assault at the settlement, and dedupes the triple capture report", () => {
    const led = createLedger();
    led.ingest(SIEGE_SEQ);
    const snap = led.snapshot();

    expect(snap.byFaction.parthia.sieges).toBe(1); // begun + assault + capture ≠ 3
    const battle = snap.events.find(e => e.kind === "battle");
    expect(battle).toMatchObject({ battleType: "siege_assault", winner: "parthia", loser: "slave", location: "Bactria" });

    const captures = snap.events.filter(e => e.kind === "assault_captured" || e.kind === "settlement_captured");
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ kind: "assault_captured", winner: "parthia", loser: "slave", settlement: "Bactria" });

    expect(snap.events.some(e => e.kind === "siege_begun" && e.faction === "parthia" && e.settlement === "Bactria")).toBe(true);
  });

  it("still credits the siege on SUCCESSFUL_ASSAULT when the siege-begun line was never seen", () => {
    const led = createLedger();
    led.ingest("faction(egypt) surrenders Memphis to faction(seleucid). Reason - SUCCESSFUL_ASSAULT");
    const snap = led.snapshot();
    expect(snap.byFaction.seleucid.sieges).toBe(1);
    expect(snap.events[0].kind).toBe("assault_captured");
  });

  it("records a lifted siege", () => {
    const led = createLedger();
    led.ingest("siege by Atheas(f88ff8c0)(army:dc52ebf0) on Pella(7,49) has been ended");
    expect(led.snapshot().events[0]).toMatchObject({ kind: "siege_ended", settlement: "Pella" });
  });
});

describe("dedupe", () => {
  it("re-ingesting the same chunk in the same turn changes nothing (backfill/tail overlap)", () => {
    const led = createLedger();
    led.ingest(NAVAL_BATTLE);
    const before = led.snapshot();
    expect(led.ingest(NAVAL_BATTLE)).toBe(0);
    const after = led.snapshot();
    expect(after.byFaction).toEqual(before.byFaction);
    expect(after.events.length).toBe(before.events.length);
  });

  it("a genuine rematch after an end-round marker DOES count", () => {
    const led = createLedger();
    led.ingest(FIELD_BATTLE);
    led.ingest(END_ROUND);
    led.ingest(FIELD_BATTLE);
    const snap = led.snapshot();
    expect(snap.turn).toBe(2);
    expect(snap.byFaction.parthia).toMatchObject({ fought: 2, won: 2 });
    expect(snap.byFaction.parthia.opponents.scythia).toBe(2);
  });

  it("the redundant winner/loser lines inside one battle produce exactly one battle", () => {
    const led = createLedger();
    led.ingest(NAVAL_BATTLE);
    expect(led.snapshot().events.filter(e => e.kind === "battle")).toHaveLength(1);
  });
});

describe("opponent counts across multiple battles", () => {
  it("accumulates per-opponent tallies for both sides", () => {
    const led = createLedger();
    led.ingest(NAVAL_BATTLE);   // macedon beats slave
    led.ingest(END_ROUND);
    led.ingest(FIELD_BATTLE);   // parthia beats scythia
    led.ingest(END_ROUND);
    // macedon fights parthia this time
    led.ingest([
      "Conflict Type(Normal)",
      "***** Battle Setup Phase Started *****",
      "adding main army(dddd1111:macedon:0 alnce0) to battle",
      "adding main army(dddd2222:parthia:1 alnce1) to battle",
      "winning army King Philippos(dddd1111:macedon) has been assessed",
      "losing army Captain Arsakes(dddd2222:parthia) has been assessed",
    ].join("\n"));

    const snap = led.snapshot();
    expect(snap.byFaction.macedon).toMatchObject({ fought: 2, won: 2, lost: 0 });
    expect(snap.byFaction.macedon.opponents).toEqual({ slave: 1, parthia: 1 });
    expect(snap.byFaction.parthia).toMatchObject({ fought: 2, won: 1, lost: 1 });
    expect(snap.byFaction.parthia.opponents).toEqual({ scythia: 1, macedon: 1 });
  });
});

describe("event feed cap", () => {
  it("keeps only the newest 500 events, newest first", () => {
    const led = createLedger();
    for (let i = 0; i < 600; i++) {
      const uuid = (0x10000000 + i).toString(16);
      led.ingest(`Captain Nobody(gauls) army(${uuid}) is dead`);
    }
    const snap = led.snapshot();
    expect(snap.byFaction.gauls.armiesLost).toBe(600); // aggregates NOT capped
    expect(snap.events).toHaveLength(500);
    expect(snap.events[0].seq).toBe(600);   // newest first
    expect(snap.events[499].seq).toBe(101); // oldest kept
  });
});

describe("parsed-event-object ingestion", () => {
  it("handles App.js-style siege / surrender objects", () => {
    const led = createLedger();
    led.ingest({ type: "siege", general: "Alexander", settlement: "Byzantium", status: "begun" });
    led.ingest({ type: "surrender", from: "thrace", settlement: "Byzantium", to: "macedon", reason: "SUCCESSFUL_ASSAULT" });
    const snap = led.snapshot();
    expect(snap.events.some(e => e.kind === "siege_begun" && e.settlement === "Byzantium")).toBe(true);
    expect(snap.byFaction.macedon.sieges).toBe(1);
  });

  it("handles messageLogParser-style army_dead objects", () => {
    const led = createLedger();
    led.ingest({ type: "army_dead", commanderName: "Captain Adymos", faction: "scythia", armyUuid: "c38bf080" });
    const snap = led.snapshot();
    expect(snap.byFaction.scythia.armiesLost).toBe(1);
    expect(snap.events[0]).toMatchObject({ kind: "army_destroyed", faction: "scythia", commanderName: "Captain Adymos" });
  });

  it("records a faction-less battle_outcome object in the feed without corrupting byFaction", () => {
    const led = createLedger();
    expect(led.ingest({ type: "battle_outcome", winner: "Captain A", loser: "Captain B" })).toBe(1);
    const snap = led.snapshot();
    expect(Object.keys(snap.byFaction)).toHaveLength(0);
    expect(snap.events[0]).toMatchObject({ kind: "battle", winner: null, loser: null, winnerName: "Captain A", loserName: "Captain B" });
    // Exact repeat in the same turn dedupes; a different pairing does not.
    expect(led.ingest({ type: "battle_outcome", winner: "Captain A", loser: "Captain B" })).toBe(0);
    expect(led.ingest({ type: "battle_outcome", winner: "Captain C", loser: "Captain D" })).toBe(1);
  });

  it("attributes a parser-style battle_outcome when army uuids are known from earlier lines", () => {
    const led = createLedger();
    // Seed the army→faction map via move lines, then feed the parsed object.
    led.ingest("Admiral Assandros(11112222:army(a5bb1c20):macedon:admiral):MOVING_NORMAL:start(1,1):end(2,2)");
    led.ingest("Admiral Atheas(33334444:army(c0cfe280):slave:admiral):MOVING_NORMAL:start(3,3):end(4,4)");
    led.ingest({ type: "battle_outcome", winnerName: "Admiral Assandros", winnerUuid: "a5bb1c20", loserName: "Admiral Atheas", loserUuid: "c0cfe280" });
    const snap = led.snapshot();
    expect(snap.byFaction.macedon).toMatchObject({ fought: 1, won: 1 });
    expect(snap.byFaction.slave).toMatchObject({ fought: 1, lost: 1 });
  });

  it("advances the turn from App.js-style turn objects", () => {
    const led = createLedger();
    led.ingest({ type: "turn", turn: 7 });
    expect(led.snapshot().turn).toBe(7);
  });
});

describe("reset", () => {
  it("wipes aggregates, events, and dedupe state", () => {
    const led = createLedger();
    led.ingest(NAVAL_BATTLE);
    led.reset();
    let snap = led.snapshot();
    expect(Object.keys(snap.byFaction)).toHaveLength(0);
    expect(snap.events).toHaveLength(0);
    expect(snap.turn).toBe(1);
    // Same lines count again after a reset (new campaign).
    led.ingest(NAVAL_BATTLE);
    snap = led.snapshot();
    expect(snap.byFaction.macedon.won).toBe(1);
  });
});

describe("noise immunity", () => {
  it("ignores non-battle firehose lines", () => {
    const led = createLedger();
    const added = led.ingest([
      "Captain Cambyses(a638fee0:army(a5bb19e0):parthia:general):MOVING_NORMAL:start(94,28):end(88,26)",
      "Marcus Aemilius(a1b2c3d0) has gained a new trait(GoodCommander)(level-Confident Commander)",
      "region(3) - harvest status(poor), famine threat(ok)",
      "Music manager playing track data/sounds/music/CampaignBattle1-Time_2_Kill.opus",
      "BATTLE_ALLIANCE_STATS::clear() setting battle result to none",
      "settlement 'Suza' damaged (riot, 968 deaths)",
      "",
    ].join("\n"));
    expect(added).toBe(0);
    expect(led.snapshot().events).toHaveLength(0);
    expect(Object.keys(led.snapshot().byFaction)).toHaveLength(0);
  });
});
