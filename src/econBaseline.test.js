// Hermetic unit tests for src/econBaseline.js — synthetic snapshots only, no
// mod files touched. (incomeModel.test.js's "fixture mod" is built inline per
// test-run and does not exercise computeTurn1Budget — it lacks map/region
// files — so the full-snapshot path is smoke-tested live against RIS instead;
// see the feature's verification notes.)
import { describe, test, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const eb = require("./econBaseline.js");

const snap = (factions) => ({ at: "2026-07-17T00:00:00.000Z", modDataDir: "X:/mod", metric: "test", factions });
const row = (settlements, income, upkeep, net) => ({ settlements, income, upkeep, net });

describe("diffEconSnapshots — threshold filtering", () => {
  test("only |deltaPct| ≥ threshold survives; equal values never produce rows", () => {
    const base = snap({ a: row(10, 1000, 500, 500), b: row(5, 2000, 1000, 1000) });
    const cur = snap({ a: row(10, 1050, 500, 550), b: row(5, 2400, 1000, 1400) }); // a: +5%/+10%, b: +20%/+40%
    const d = eb.diffEconSnapshots(cur, base, 10);
    // a.income +5% is below threshold; a.net +10% is exactly at threshold (inclusive)
    const keys = d.rows.map(r => r.faction + "." + r.field);
    expect(keys).toContain("a.net");
    expect(keys).not.toContain("a.income");
    expect(keys).toContain("b.income");
    expect(keys).toContain("b.net");
    // untouched fields (settlements, upkeep) produce no rows at all
    expect(d.rows.some(r => r.field === "settlements" || r.field === "upkeep")).toBe(false);
  });

  test("threshold default is 10 when omitted/invalid", () => {
    const base = snap({ a: row(1, 1000, 0, 0) });
    const cur = snap({ a: row(1, 1090, 0, 0) }); // +9%
    expect(eb.diffEconSnapshots(cur, base).rows).toHaveLength(0);
    expect(eb.diffEconSnapshots(cur, base, NaN).rows).toHaveLength(0);
    expect(eb.diffEconSnapshots(cur, base, 5).rows).toHaveLength(1);
  });

  test("threshold 0 reports every change but still no rows for unchanged fields", () => {
    const base = snap({ a: row(3, 100, 50, 50) });
    const cur = snap({ a: row(3, 101, 50, 51) });
    const d = eb.diffEconSnapshots(cur, base, 0);
    expect(d.rows.map(r => r.field).sort()).toEqual(["income", "net"]);
  });
});

describe("diffEconSnapshots — added/removed factions", () => {
  test("factions only in current are added; only in baseline are removed; neither produces field rows", () => {
    const base = snap({ old: row(2, 100, 10, 90), both: row(4, 400, 40, 360) });
    const cur = snap({ neu: row(1, 50, 5, 45), both: row(4, 400, 40, 360) });
    const d = eb.diffEconSnapshots(cur, base, 10);
    expect(d.added).toEqual(["neu"]);
    expect(d.removed).toEqual(["old"]);
    expect(d.rows).toHaveLength(0);
  });

  test("added/removed lists are sorted", () => {
    const base = snap({ z: row(1, 1, 1, 1), m: row(1, 1, 1, 1) });
    const cur = snap({ c: row(1, 1, 1, 1), a: row(1, 1, 1, 1) });
    const d = eb.diffEconSnapshots(cur, base, 10);
    expect(d.added).toEqual(["a", "c"]);
    expect(d.removed).toEqual(["m", "z"]);
  });
});

describe("diffEconSnapshots — sign conventions", () => {
  test("deltaPct positive = value went UP vs baseline, negative = down", () => {
    const base = snap({ a: row(10, 1000, 1000, 1000) });
    const cur = snap({ a: row(10, 1500, 500, 800) });
    const d = eb.diffEconSnapshots(cur, base, 10);
    const by = Object.fromEntries(d.rows.map(r => [r.field, r]));
    expect(by.income.deltaPct).toBe(50);     // 1000 → 1500
    expect(by.upkeep.deltaPct).toBe(-50);    // 1000 → 500
    expect(by.net.deltaPct).toBe(-20);       // 1000 → 800
    expect(by.income.base).toBe(1000);
    expect(by.income.cur).toBe(1500);
  });

  test("negative-base net (deficit shrinking) reports the raw signed pct vs |base|", () => {
    // net -1000 → -500: value went UP (deficit halved) → +50%
    const base = snap({ a: row(1, 0, 0, -1000) });
    const cur = snap({ a: row(1, 0, 0, -500) });
    const d = eb.diffEconSnapshots(cur, base, 10);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].deltaPct).toBe(50);
  });

  test("zero base is guarded (÷max(|base|,1)) — finite, JSON-safe deltaPct", () => {
    const base = snap({ a: row(1, 0, 0, 0) });
    const cur = snap({ a: row(1, 3, 0, 3) });
    const d = eb.diffEconSnapshots(cur, base, 10);
    const by = Object.fromEntries(d.rows.map(r => [r.field, r]));
    expect(by.income.deltaPct).toBe(300);    // (3-0)/max(0,1)×100
    expect(Number.isFinite(by.income.deltaPct)).toBe(true);
    expect(JSON.stringify(d)).not.toContain("null,"); // no Infinity→null serialization holes
  });

  test("FIELD_DIRECTION encodes better-direction: income/net up-good, upkeep up-bad, settlements neutral", () => {
    expect(eb.FIELD_DIRECTION).toEqual({ settlements: 0, income: 1, upkeep: -1, net: 1 });
  });
});

describe("diffEconSnapshots — ordering and rounding", () => {
  test("rows sorted by |deltaPct| descending, deterministic tiebreak", () => {
    const base = snap({ a: row(1, 100, 100, 100), b: row(1, 100, 100, 100) });
    const cur = snap({ a: row(1, 150, 100, 80), b: row(1, 100, 130, 100) }); // +50, -20, +30
    const d = eb.diffEconSnapshots(cur, base, 10);
    expect(d.rows.map(r => Math.abs(r.deltaPct))).toEqual([50, 30, 20]);
  });

  test("deltaPct rounded to 1 decimal", () => {
    const base = snap({ a: row(1, 300, 0, 0) });
    const cur = snap({ a: row(1, 350, 0, 0) }); // +16.666…%
    const d = eb.diffEconSnapshots(cur, base, 10);
    expect(d.rows[0].deltaPct).toBe(16.7);
  });
});

describe("snapshotRowFromBudget — budget → snapshot row seam", () => {
  test("maps totals.income/armyUpkeep/net and nSettlements", () => {
    const r = eb.snapshotRowFromBudget({
      nSettlements: 7,
      totals: { income: 35269, armyUpkeep: 27692, net: -2400, armyBudget: 25292 },
    });
    expect(r).toEqual({ settlements: 7, income: 35269, upkeep: 27692, net: -2400 });
  });

  test("null armyUpkeep/net falls back to armyBudget − 0 (no NaN in snapshots)", () => {
    const r = eb.snapshotRowFromBudget({ nSettlements: 2, totals: { income: 500, armyUpkeep: null, net: null, armyBudget: 400 } });
    expect(r).toEqual({ settlements: 2, income: 500, upkeep: 0, net: 400 });
  });

  test("garbage in → zeros out (never NaN)", () => {
    const r = eb.snapshotRowFromBudget({});
    expect(r).toEqual({ settlements: 0, income: 0, upkeep: 0, net: 0 });
  });
});
