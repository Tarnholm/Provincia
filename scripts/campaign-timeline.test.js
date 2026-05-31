// Unit tests for the pure helpers in campaign-timeline.js — sort-by-turn and
// the consecutive-turn delta. These use synthetic rows (no save files), so they
// run anywhere. NOTE: this worktree lives under .claude/, which vite.config.js
// excludes from the test run; these tests execute from the canonical repo tree.

import { describe, test, expect } from "vitest";
import { sortByTurn, computeDelta, phaseRank, groupByCampaign } from "./campaign-timeline.js";

function row(over) {
  return {
    file: "s.sav", player: "romans_julii", turn: 1, year: -270, seasonIndex: 0,
    treasury: 1000, income: 500, regions: 5, units: 3, soldiers: 600, wars: 0, allies: 1, family: 4,
    _ownerByCity: {}, _diplomacy: { war: [], allied: [] }, _family: [],
    ...over,
  };
}

describe("sortByTurn — orders by cracked turn, not filename", () => {
  test("strictly increasing turn order regardless of input order/filename", () => {
    const rows = [
      row({ file: "zzz Turn 34 Start.sav", turn: 34 }),
      row({ file: "aaa Turn 2.sav", turn: 2 }),
      row({ file: "mmm Turn 5 Start.sav", turn: 5 }),
      row({ file: "bbb Turn 8 End.sav", turn: 8 }),
    ];
    const turns = sortByTurn(rows).map((r) => r.turn);
    expect(turns).toEqual([2, 5, 8, 34]);
  });

  test("ties broken Start < bare < End", () => {
    const rows = [
      row({ file: "Turn 3 End.sav", turn: 3 }),
      row({ file: "Turn 3 Start.sav", turn: 3 }),
      row({ file: "Turn 3.sav", turn: 3 }),
    ];
    expect(sortByTurn(rows).map((r) => r.file)).toEqual([
      "Turn 3 Start.sav", "Turn 3.sav", "Turn 3 End.sav",
    ]);
  });

  test("null turns sort last", () => {
    const rows = [row({ file: "unknown.sav", turn: null }), row({ file: "t1.sav", turn: 1 })];
    expect(sortByTurn(rows).map((r) => r.file)).toEqual(["t1.sav", "unknown.sav"]);
  });
});

describe("phaseRank", () => {
  test("Start=0, bare=1, End=2", () => {
    expect(phaseRank("foo Turn 2 Start.sav")).toBe(0);
    expect(phaseRank("foo Turn 2.sav")).toBe(1);
    expect(phaseRank("foo Turn 2 End.sav")).toBe(2);
  });
});

describe("groupByCampaign", () => {
  test("groups rows by tracked player faction", () => {
    const g = groupByCampaign([
      row({ player: "romans_julii" }),
      row({ player: "carthage" }),
      row({ player: "romans_julii" }),
    ]);
    expect(g.romans_julii.length).toBe(2);
    expect(g.carthage.length).toBe(1);
  });
});

describe("computeDelta — what-changed between consecutive turns", () => {
  const player = "romans_julii";

  test("settlements gained and lost are attributed to the tracked faction", () => {
    const prev = row({ _ownerByCity: { Rome: player, Capua: "samnites" } });
    const cur = row({ _ownerByCity: { Rome: "rebels", Capua: player, Tarentum: player } });
    const d = computeDelta(prev, cur);
    expect(d.settlementsGained.map((s) => s.city).sort()).toEqual(["Capua", "Tarentum"]);
    expect(d.settlementsLost.map((s) => s.city)).toEqual(["Rome"]);
  });

  test("treasury swing is the signed difference", () => {
    expect(computeDelta(row({ treasury: 1000 }), row({ treasury: 600 })).treasurySwing).toBe(-400);
    expect(computeDelta(row({ treasury: 600 }), row({ treasury: 1000 })).treasurySwing).toBe(400);
  });

  test("treasury swing is null when either side lacks a treasury", () => {
    expect(computeDelta(row({ treasury: null }), row({ treasury: 600 })).treasurySwing).toBeNull();
  });

  test("wars/alliances declared and ended are diffed from the faction's lists", () => {
    const prev = row({ _diplomacy: { war: ["samnites"], allied: ["roman_senate"] } });
    const cur = row({ _diplomacy: { war: ["samnites", "syracuse"], allied: [] } });
    const d = computeDelta(prev, cur);
    expect(d.newWar).toEqual(["syracuse"]);
    expect(d.endWar).toEqual([]);
    expect(d.newAlly).toEqual([]);
    expect(d.endAlly).toEqual(["roman_senate"]);
  });

  test("births and deaths counted by uuid across a continuous chain", () => {
    const prev = row({ _family: [
      { uuid: 1, alive: true }, { uuid: 2, alive: true }, { uuid: 3, alive: true },
    ] });
    const cur = row({ _family: [
      { uuid: 1, alive: true }, { uuid: 2, alive: false }, { uuid: 4, alive: true },
    ] });
    const d = computeDelta(prev, cur);
    expect(d.familyChainBroken).toBe(false);
    expect(d.births).toBe(1);  // uuid 4 is new
    expect(d.deaths).toBe(1);  // uuid 2 died
  });

  test("family delta suppressed (chain break) when rosters share no uuids", () => {
    const prev = row({ _family: [{ uuid: 1, alive: true }, { uuid: 2, alive: true }] });
    const cur = row({ _family: [{ uuid: 100, alive: true }, { uuid: 101, alive: true }] });
    const d = computeDelta(prev, cur);
    expect(d.familyChainBroken).toBe(true);
    expect(d.births).toBe(0);  // NOT 2 — would be a fabricated "everyone born"
    expect(d.deaths).toBe(0);
  });
});
