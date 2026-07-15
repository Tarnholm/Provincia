// Unit tests for messageLogParser — the live message_log.txt event parser.
// Pure functions; inputs are real engine log lines (from the module's own
// documented examples). Guards the turn-to-turn state feed: a broken regex
// here silently freezes unit markers until the next save snapshot.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseLine, parseChunk, shortUuid } = require("./messageLogParser.js");

describe("shortUuid", () => {
  it("returns null for nullish input", () => {
    expect(shortUuid(null)).toBeNull();
    expect(shortUuid("")).toBeNull();
  });
  it("passes through a 32-bit id unchanged", () => {
    expect(shortUuid("a638ccd0")).toBe("a638ccd0");
  });
  it("truncates a long memory-pointer uuid to its last 8 hex chars", () => {
    expect(shortUuid("1e8a7a5da60")).toBe("a7a5da60");
  });
});

describe("parseLine — rejection of non-events", () => {
  it("rejects empty / too-short lines", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("short")).toBeNull();
  });
  it("rejects lines that do not start with a word character (boot spam)", () => {
    expect(parseLine("0xdeadbeef pointer noise here")).toBeNull();
  });
  it("returns null for a well-formed line matching no pattern", () => {
    expect(parseLine("random noise line that matches nothing")).toBeNull();
  });
});

describe("parseLine — character_move", () => {
  it("parses a MOVING_NORMAL line", () => {
    const ev = parseLine(
      "Captain Cambyses(a638fee0:army(a5bb19e0):parthia:general):MOVING_NORMAL:start(94,28):end(88,26)",
    );
    expect(ev).toMatchObject({
      type: "character_move",
      name: "Captain Cambyses",
      charUuid: "a638fee0",
      armyUuid: "a5bb19e0",
      faction: "parthia",
      role: "general",
      status: "MOVING_NORMAL",
      fromX: 94, fromY: 28, toX: 88, toY: 26,
      multiTurnsLeft: 0,
      loco: null,
    });
  });

  it("tolerates a trailing siege-scroll suffix and reads multi-turns left", () => {
    const ev = parseLine(
      "Captain Cambyses(a638fee0:army(a5bb19e0):parthia:general):MOVING_NORMAL:start(94,28):end(88,26):multi-turns left(2) seige_scroll scroll closed",
    );
    expect(ev.type).toBe("character_move");
    expect(ev.multiTurnsLeft).toBe(2);
  });
});

describe("parseLine — trait / battle / army", () => {
  it("parses a trait_gain line", () => {
    const ev = parseLine("Marcus(a638ccd0) has gained a new trait(GoodCommander)(level-Skilled Attacker)");
    expect(ev).toMatchObject({
      type: "trait_gain",
      name: "Marcus",
      charUuid: "a638ccd0",
      trait: "GoodCommander",
      level: "Skilled Attacker",
    });
  });

  it("parses an autoresolved battle_outcome line", () => {
    const ev = parseLine("Aulus(a1b2c3d4) has defeated Brennus(d4c3b2a1) in an autoresolved battle");
    expect(ev).toMatchObject({
      type: "battle_outcome",
      winnerName: "Aulus", winnerUuid: "a1b2c3d4",
      loserName: "Brennus", loserUuid: "d4c3b2a1",
    });
  });

  it("parses an army_created line", () => {
    const ev = parseLine("Brigands(c3554d50) army(2 units) created in region(22) at tile(102,30)");
    expect(ev).toMatchObject({
      type: "army_created",
      name: "Brigands", charUuid: "c3554d50",
      unitCount: 2, regionId: 22, x: 102, y: 30,
    });
  });
});

describe("parseLine — settlement / campaign events", () => {
  it("parses a settlement_damaged line", () => {
    const ev = parseLine("settlement 'Suza' damaged (riot, 968 deaths)");
    expect(ev).toMatchObject({ type: "settlement_damaged", settlement: "Suza", cause: "riot", deaths: 968 });
  });

  it("parses a settlement_capture line", () => {
    const ev = parseLine("faction(seleucid) captures Abai from slave. Reason - CAPTURED");
    expect(ev).toMatchObject({
      type: "settlement_capture",
      faction: "seleucid", settlement: "Abai", fromFaction: "slave", reason: "CAPTURED",
    });
  });

  it("parses an attach_region line with triumph points", () => {
    const ev = parseLine("attaching region Roma(696) to faction(romans_julii), giving them 5 triumph points");
    expect(ev).toMatchObject({
      type: "attach_region",
      region: "Roma", regionId: 696, faction: "romans_julii", triumphPoints: 5,
    });
  });

  it("parses a marriage line", () => {
    const ev = parseLine("Biggus Dickus(0:age 16) has married Prisca(age 21)");
    expect(ev).toMatchObject({
      type: "marriage",
      name: "Biggus Dickus", age: 16, spouse: "Prisca", spouseAge: 21,
    });
  });

  it("parses a harvest_status line", () => {
    const ev = parseLine("region(3) - harvest status(poor), famine threat(ok)");
    expect(ev).toMatchObject({ type: "harvest_status", regionId: 3, harvest: "poor", famineThreat: "ok" });
  });
});

describe("parseLine — char_death alive flag", () => {
  it("flags a DET_BATTLE death as not alive", () => {
    const ev = parseLine("Vercingetorix(gauls:general)(a1b2c3d4):death_type(DET_BATTLE)");
    expect(ev).toMatchObject({ type: "char_death", deathType: "DET_BATTLE", alive: false });
  });
  it("flags DET_ALIVE as alive", () => {
    const ev = parseLine("Vercingetorix(gauls:general)(a1b2c3d4):death_type(DET_ALIVE)");
    expect(ev.alive).toBe(true);
  });
});

describe("parseChunk", () => {
  it("returns only the parseable events, in order, from a mixed multi-line blob", () => {
    const text = [
      "0xboot spam pointer line",
      "settlement 'Suza' damaged (riot, 968 deaths)",
      "totally unrelated noise",
      "region(3) - harvest status(poor), famine threat(ok)",
      "",
    ].join("\n");
    const events = parseChunk(text);
    expect(events.map((e) => e.type)).toEqual(["settlement_damaged", "harvest_status"]);
  });
});
