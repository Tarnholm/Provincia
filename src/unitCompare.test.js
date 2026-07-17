// Hermetic tests for the Unit Comparator derivation logic (src/unitCompare.js).
// Synthetic stat objects mirror the shape returned by the get-unit-stats IPC
// handler in src/iconHandlers.js — no filesystem, no IPC.
import { describe, it, expect } from "vitest";
import { deriveComparison, defenseTotal, markBest, num, div } from "./unitCompare";

// Hastati-ish: cheap line infantry.
const A = {
  name: "unit a", soldierCount: 40, hp: 1, mountHp: 0,
  priAttack: 7, priCharge: 2, priRange: 0, priAmmo: 0,
  armour: 5, defenseSkill: 7, shield: 5, morale: 8,
  recruitTurns: 1, recruitCost: 610, upkeep: 170,
};
// Elite cavalry-ish: expensive, strong, small.
const B = {
  name: "unit b", soldierCount: 20, hp: 1, mountHp: 3,
  priAttack: 10, priCharge: 8,
  armour: 8, defenseSkill: 6, shield: 0, morale: 11,
  recruitTurns: 2, recruitCost: 800, upkeep: 200,
};

const row = (cmp, key, from = "rows") => cmp[from].find((r) => r.key === key);

describe("num / div primitives", () => {
  it("num returns null for missing/NaN/non-numeric — never 0", () => {
    expect(num(undefined)).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(NaN)).toBeNull();
    expect(num("7")).toBeNull();
    expect(num(0)).toBe(0); // a REAL zero is preserved
    expect(num(7)).toBe(7);
  });
  it("div is null on null operands or zero divisor", () => {
    expect(div(10, null)).toBeNull();
    expect(div(null, 10)).toBeNull();
    expect(div(10, 0)).toBeNull();
    expect(div(10, 4)).toBe(2.5);
  });
});

describe("defenseTotal", () => {
  it("sums armour + skill + shield", () => {
    expect(defenseTotal(A)).toBe(17);
    expect(defenseTotal(B)).toBe(14); // shield 0 is a real value, counted
  });
  it("is null when any component is missing or NaN (no partial sums)", () => {
    expect(defenseTotal({ armour: 5, defenseSkill: 7 })).toBeNull();
    expect(defenseTotal({ armour: 5, defenseSkill: NaN, shield: 2 })).toBeNull();
    expect(defenseTotal(null)).toBeNull();
  });
});

describe("derived ratios", () => {
  const cmp = deriveComparison([{ unit: "a", stats: A }, { unit: "b", stats: B }]);
  it("upkeepPerSoldier / costPerSoldier", () => {
    expect(row(cmp, "upkeepPerSoldier", "ratios").values).toEqual([170 / 40, 200 / 20]);
    expect(row(cmp, "costPerSoldier", "ratios").values).toEqual([610 / 40, 800 / 20]);
  });
  it("upkeepPerAttack", () => {
    expect(row(cmp, "upkeepPerAttack", "ratios").values[0]).toBeCloseTo(170 / 7, 10);
    expect(row(cmp, "upkeepPerAttack", "ratios").values[1]).toBe(20);
  });
  it("costPerEffectiveHp = cost / (hp × soldiers)", () => {
    expect(row(cmp, "costPerEffectiveHp", "ratios").values).toEqual([610 / 40, 800 / 20]);
  });
  it("combatPer100Upkeep = (attack + defenseTotal) × 100 / upkeep", () => {
    const r = row(cmp, "combatPer100Upkeep", "ratios");
    expect(r.values[0]).toBeCloseTo(((7 + 17) * 100) / 170, 10);
    expect(r.values[1]).toBeCloseTo(((10 + 14) * 100) / 200, 10);
  });
});

describe("best-in-row detection", () => {
  const cmp = deriveComparison([{ unit: "a", stats: A }, { unit: "b", stats: B }]);
  it("higher-is-better rows mark the max", () => {
    expect(row(cmp, "priAttack").best).toEqual([false, true]);
    expect(row(cmp, "defenseTotal").best).toEqual([true, false]);
    expect(row(cmp, "soldierCount").best).toEqual([true, false]);
  });
  it("lower-is-better rows mark the min (cost, upkeep, ratios)", () => {
    expect(row(cmp, "upkeep").best).toEqual([true, false]);
    expect(row(cmp, "recruitCost").best).toEqual([true, false]);
    expect(row(cmp, "upkeepPerSoldier", "ratios").best).toEqual([true, false]); // 4.25 < 10
  });
  it("ties mark every tied column", () => {
    const t = deriveComparison([{ unit: "a", stats: A }, { unit: "a2", stats: { ...A } }]);
    expect(row(t, "priAttack").best).toEqual([true, true]);
  });
  it("markBest needs >= 2 non-null values", () => {
    expect(markBest([5, null, null], "high")).toEqual([false, false, false]);
    expect(markBest([5, 3, null], "low")).toEqual([false, true, false]);
  });
});

describe("null-stat passthrough (never fabricate 0)", () => {
  it("NaN / missing raw stats surface as null and null ratios", () => {
    const C = { soldierCount: 30, priAttack: NaN, hp: 1 }; // upkeep/cost/armour absent entirely
    const cmp = deriveComparison([{ unit: "a", stats: A }, { unit: "c", stats: C }]);
    expect(row(cmp, "priAttack").values).toEqual([7, null]);
    expect(row(cmp, "upkeep").values).toEqual([170, null]);
    expect(row(cmp, "defenseTotal").values).toEqual([17, null]);
    expect(row(cmp, "upkeepPerSoldier", "ratios").values).toEqual([170 / 40, null]); // A's real value, C null
    expect(row(cmp, "combatPer100Upkeep", "ratios").values[1]).toBeNull();
    // C must never be marked best via a fabricated 0 on lower-is-better rows
    expect(row(cmp, "upkeep").best).toEqual([false, false]); // only 1 non-null → no flags
  });
  it("stats:null column (unit not found in EDU) is all null", () => {
    const cmp = deriveComparison([{ unit: "a", stats: A }, { unit: "ghost", stats: null }]);
    for (const r of [...cmp.rows, ...cmp.ratios]) {
      expect(r.values[1]).toBeNull();
      expect(r.best[1]).toBe(false);
    }
    expect(cmp.units).toEqual(["a", "ghost"]);
  });
  it("0 as DIVISOR yields null (guard, not Infinity); 0 as numerator is a real 0", () => {
    const Z = { ...A, upkeep: 0, priAttack: 0 };
    const cmp = deriveComparison([{ unit: "z", stats: Z }]);
    expect(row(cmp, "upkeepPerAttack", "ratios")?.values?.[0] ?? null).toBeNull();      // attack 0 divisor → null
    expect(row(cmp, "combatPer100Upkeep", "ratios")?.values?.[0] ?? null).toBeNull();   // upkeep 0 divisor → null
    expect(row(cmp, "upkeepPerSoldier", "ratios").values[0]).toBe(0);                    // 0/40 is a REAL zero, kept
  });
});

describe("row pruning", () => {
  it("rows where every unit is null are dropped (mountHp for all-infantry, missing stat_sec)", () => {
    const cmp = deriveComparison([{ unit: "a", stats: A }]);
    expect(row(cmp, "mountHp")).toBeUndefined();  // A.mountHp is 0 → treated as no mount
    expect(row(cmp, "secAttack")).toBeUndefined(); // A has no stat_sec
    const cmp2 = deriveComparison([{ unit: "b", stats: B }]);
    expect(row(cmp2, "mountHp")).toBeDefined();    // B's mount is real
  });
});

describe("single-unit and empty cases", () => {
  it("single unit: values present, no best flags anywhere", () => {
    const cmp = deriveComparison([{ unit: "a", stats: A }]);
    expect(cmp.units).toEqual(["a"]);
    expect(row(cmp, "priAttack").values).toEqual([7]);
    for (const r of [...cmp.rows, ...cmp.ratios]) expect(r.best.every((b) => b === false)).toBe(true);
  });
  it("empty list and bad input yield empty results", () => {
    expect(deriveComparison([])).toEqual({ units: [], rows: [], ratios: [] });
    expect(deriveComparison(null)).toEqual({ units: [], rows: [], ratios: [] });
    expect(deriveComparison(undefined)).toEqual({ units: [], rows: [], ratios: [] });
  });
});
