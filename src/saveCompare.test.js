// Hermetic unit tests for src/saveCompare.js — synthetic cracked-save shapes
// and synthetic summaries only; no save files, no workers, no I/O.
import { describe, test, expect } from "vitest";
import { summarizeForCompare, diffSaveSummaries, POP_TOP_N } from "./saveCompare.js";

// Minimal cracked-save-shaped object (the fields summarizeForCompare reads).
function crackedFixture() {
  return {
    playerFaction: "romans_julii",
    turn: 12,
    currentYear: -268,
    seasonIndex: 3,
    ownerByCity: { Rome: "romans_julii", Arretium: "romans_julii", Carthage: "carthage" },
    factions: {
      romans_julii: { treasury: 5000, regionCount: 2 },
      carthage: { treasury: 12000, regionCount: 1 },
      dummies: { treasury: null },
    },
    units: [
      { faction: "romans_julii", soldiers: 120 },
      { faction: "romans_julii", soldiers: 80 },
      { faction: "carthage", soldiers: 240 },
      { faction: null, soldiers: 40 }, // unattributed — must be ignored
    ],
    settlementFields: {
      Rome: { committedPopulation: 4000, projectedPopulation: 4100 },
      Arretium: { projectedPopulation: 2000 }, // committed missing → fallback
      Carthage: { committedPopulation: null, projectedPopulation: null }, // undecoded → omitted
    },
  };
}

describe("summarizeForCompare", () => {
  test("normalizes a cracked save into the compare summary", () => {
    const s = summarizeForCompare(crackedFixture());
    expect(s.ownerBySettlement).toEqual({ Rome: "romans_julii", Arretium: "romans_julii", Carthage: "carthage" });
    expect(s.treasuryByFaction).toEqual({ romans_julii: 5000, carthage: 12000, dummies: null });
    expect(s.unitCountByFaction).toEqual({ romans_julii: 2, carthage: 1 });
    expect(s.soldiersByFaction).toEqual({ romans_julii: 200, carthage: 240 });
    // committedPopulation preferred; projected fallback; undecoded omitted
    expect(s.popBySettlement).toEqual({ Rome: 4000, Arretium: 2000 });
    expect(s.turn).toBe(12);
    expect(s.turnLabel).toBe("Turn 12 · Winter 268 BC");
    expect(s.playerFaction).toBe("romans_julii");
  });

  test("accepts a timeline-style row (_ownerByCity) and tolerates missing fields", () => {
    const s = summarizeForCompare({ _ownerByCity: { Rome: "romans_julii" }, turn: 3, file: "a.sav" });
    expect(s.ownerBySettlement).toEqual({ Rome: "romans_julii" });
    expect(s.treasuryByFaction).toEqual({});
    expect(s.unitCountByFaction).toEqual({});
    expect(s.popBySettlement).toEqual({});
    expect(s.turnLabel).toBe("Turn 3");
  });

  test("empty/null input yields empty maps, null turn, fallback label", () => {
    const s = summarizeForCompare(null);
    expect(s.ownerBySettlement).toEqual({});
    expect(s.turn).toBe(null);
    expect(s.turnLabel).toBe("unknown turn");
  });
});

// Convenience builder for hand-rolled summaries.
function summary(over = {}) {
  return {
    ownerBySettlement: {},
    treasuryByFaction: {},
    unitCountByFaction: {},
    soldiersByFaction: {},
    popBySettlement: {},
    turn: null,
    turnLabel: null,
    playerFaction: null,
    file: null,
    path: null,
    ...over,
  };
}

describe("diffSaveSummaries — ownership flips", () => {
  test("detects flips only for settlements present in both summaries", () => {
    const a = summary({ ownerBySettlement: { Rome: "julii", Capua: "julii", Messana: "carthage", Ghost: "julii" } });
    const b = summary({ ownerBySettlement: { Rome: "julii", Capua: "carthage", Messana: "julii" } }); // Ghost missing in b
    const d = diffSaveSummaries(a, b);
    expect(d.flips).toEqual([
      { settlement: "Capua", from: "julii", to: "carthage" },
      { settlement: "Messana", from: "carthage", to: "julii" },
    ]);
  });

  test("no flips on identical ownership", () => {
    const own = { Rome: "julii", Carthage: "carthage" };
    const d = diffSaveSummaries(summary({ ownerBySettlement: own }), summary({ ownerBySettlement: { ...own } }));
    expect(d.flips).toEqual([]);
  });
});

describe("diffSaveSummaries — faction rows", () => {
  test("computes settlement, treasury and unit deltas per faction", () => {
    const a = summary({
      ownerBySettlement: { Rome: "julii", Capua: "julii", Messana: "carthage" },
      treasuryByFaction: { julii: 5000, carthage: 12000 },
      unitCountByFaction: { julii: 10, carthage: 8 },
      soldiersByFaction: { julii: 1000, carthage: 900 },
    });
    const b = summary({
      ownerBySettlement: { Rome: "julii", Capua: "julii", Messana: "julii" },
      treasuryByFaction: { julii: 4000, carthage: 15000 },
      unitCountByFaction: { julii: 12, carthage: 5 },
      soldiersByFaction: { julii: 1300, carthage: 500 },
    });
    const d = diffSaveSummaries(a, b);
    const julii = d.factionRows.find((r) => r.faction === "julii");
    const carthage = d.factionRows.find((r) => r.faction === "carthage");
    expect(julii).toMatchObject({ settlementsFrom: 2, settlementsTo: 3, settlementsDelta: 1, treasuryDelta: -1000, unitsDelta: 2, soldiersDelta: 300 });
    expect(carthage).toMatchObject({ settlementsFrom: 1, settlementsTo: 0, settlementsDelta: -1, treasuryDelta: 3000, unitsDelta: -3, soldiersDelta: -400 });
    expect(carthage.disappeared).toBe(false); // still has units
  });

  test("unchanged factions are omitted; appearance/disappearance flagged", () => {
    const a = summary({
      ownerBySettlement: { Rome: "julii", Syracuse: "greek_cities" },
      treasuryByFaction: { julii: 100, greek_cities: 200, macedon: 300 },
      unitCountByFaction: { greek_cities: 4 },
    });
    const b = summary({
      ownerBySettlement: { Rome: "julii", Syracuse: "julii" },
      treasuryByFaction: { julii: 100, greek_cities: 200, macedon: 300 },
      unitCountByFaction: { rebels: 2 },
    });
    const d = diffSaveSummaries(a, b);
    // macedon: no settlements, same treasury, no units → not a row
    expect(d.factionRows.find((r) => r.faction === "macedon")).toBeUndefined();
    // julii: same treasury but +1 settlement → present
    expect(d.factionRows.find((r) => r.faction === "julii").settlementsDelta).toBe(1);
    // greek_cities lost its only settlement AND its units → disappeared
    expect(d.factionRows.find((r) => r.faction === "greek_cities").disappeared).toBe(true);
    // rebels had nothing before, has units now → appeared
    expect(d.factionRows.find((r) => r.faction === "rebels")).toMatchObject({ appeared: true, unitsDelta: null });
  });

  test("null treasuries produce null deltas (no fabrication)", () => {
    const a = summary({ treasuryByFaction: { julii: null, carthage: 100 } });
    const b = summary({ treasuryByFaction: { julii: 500, carthage: 100 } });
    const d = diffSaveSummaries(a, b);
    expect(d.factionRows.find((r) => r.faction === "julii")).toBeUndefined(); // null delta + nothing else → unchanged
    expect(d.factionRows.find((r) => r.faction === "carthage")).toBeUndefined();
  });

  test("rows sort by |settlementsDelta| then |treasuryDelta|", () => {
    const a = summary({
      ownerBySettlement: { s1: "big", s2: "big", s3: "big", s4: "small" },
      treasuryByFaction: { rich: 0 },
    });
    const b = summary({
      ownerBySettlement: { s1: "small", s2: "small", s3: "big", s4: "small" },
      treasuryByFaction: { rich: 99999 },
    });
    const d = diffSaveSummaries(a, b);
    expect(d.factionRows.map((r) => r.faction)).toEqual(["big", "small", "rich"]);
  });
});

describe("diffSaveSummaries — population rows", () => {
  test("reports from/to/delta, skips one-sided and unchanged settlements", () => {
    const a = summary({ popBySettlement: { Rome: 4000, Capua: 2000, OnlyA: 500 } });
    const b = summary({ popBySettlement: { Rome: 4400, Capua: 2000, OnlyB: 800 } });
    const d = diffSaveSummaries(a, b);
    expect(d.popRows).toEqual([{ settlement: "Rome", from: 4000, to: 4400, delta: 400 }]);
    expect(d.meta.popChangedTotal).toBe(1);
    expect(d.meta.popRowsTruncated).toBe(false);
  });

  test("trims to top " + POP_TOP_N + " by |delta| (negatives count by magnitude)", () => {
    const popA = {}, popB = {};
    for (let i = 1; i <= 30; i++) {
      popA["city" + i] = 1000;
      // deltas: city1 → -1, city2 → +2, ..., city30 → ±30 (even = growth, odd = decline)
      popB["city" + i] = 1000 + (i % 2 === 0 ? i : -i);
    }
    const d = diffSaveSummaries(summary({ popBySettlement: popA }), summary({ popBySettlement: popB }));
    expect(d.popRows.length).toBe(POP_TOP_N);
    expect(d.meta.popChangedTotal).toBe(30);
    expect(d.meta.popRowsTruncated).toBe(true);
    // Sorted by |delta| descending: 30, 29, 28, ...
    expect(Math.abs(d.popRows[0].delta)).toBe(30);
    expect(Math.abs(d.popRows[POP_TOP_N - 1].delta)).toBe(30 - POP_TOP_N + 1);
    // The smallest |delta| cities were trimmed
    expect(d.popRows.find((r) => r.settlement === "city1")).toBeUndefined();
  });
});

describe("diffSaveSummaries — meta", () => {
  test("identical summaries → identical flag, empty sections", () => {
    const s = summary({
      ownerBySettlement: { Rome: "julii" },
      treasuryByFaction: { julii: 5000 },
      unitCountByFaction: { julii: 3 },
      soldiersByFaction: { julii: 300 },
      popBySettlement: { Rome: 4000 },
      turn: 7,
      turnLabel: "Turn 7",
      file: "x.sav",
    });
    // Deep-clone so identity equality can't mask a real comparison
    const d = diffSaveSummaries(s, JSON.parse(JSON.stringify(s)));
    expect(d.flips).toEqual([]);
    expect(d.factionRows).toEqual([]);
    expect(d.popRows).toEqual([]);
    expect(d.meta.identical).toBe(true);
    expect(d.meta.a.turn).toBe(7);
    expect(d.meta.b.file).toBe("x.sav");
    expect(d.meta.orderSuspect).toBe(false);
  });

  test("orderSuspect when the 'earlier' save has the later turn", () => {
    const d = diffSaveSummaries(summary({ turn: 10 }), summary({ turn: 4 }));
    expect(d.meta.orderSuspect).toBe(true);
  });

  test("null/absent turns never trip orderSuspect", () => {
    expect(diffSaveSummaries(summary(), summary({ turn: 4 })).meta.orderSuspect).toBe(false);
  });
});
