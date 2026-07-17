import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  valueBuildingDelta,
  parseConstructionCosts,
  settlementTaxAt,
  paybackOf,
  classify,
} from "./buildOrder.js";

// Hermetic unit tests for the build-order optimizer's pure helpers. No mod files —
// synthetic EDB income structures + synthetic settlement state exercise the delta
// valuation, payback math, sort/category logic and the zero/negative-delta path.
// (Live RIS smoke runs only in verification, not here.)

// pop 2500 → measured popBase 629.0 (CALIB.popBasePre), so tax deltas land on clean
// integers: trunc(629 + M·pts) − trunc(629) = M·pts for integer M·pts.
const ST_MULTI_NONCAP = { pop: 2500, capital: false, tier: 5, multiTown: true, ris: true };
const ST_MULTI_CAP = { pop: 2500, capital: true, tier: 5, multiTown: true, ris: true };
const ST_SINGLE = { pop: 2500, capital: true, tier: 1, multiTown: false, ris: true };

describe("settlementTaxAt", () => {
  it("non-capital tier>=3 taxes building points at M=4", () => {
    const a = settlementTaxAt(0, ST_MULTI_NONCAP);
    const b = settlementTaxAt(5, ST_MULTI_NONCAP);
    expect(b - a).toBe(20); // 4 × 5
  });
  it("capital taxes building points at M=40", () => {
    const a = settlementTaxAt(0, ST_MULTI_CAP);
    const b = settlementTaxAt(1, ST_MULTI_CAP);
    expect(b - a).toBe(40);
  });
  it("small-empire (tier<=2) non-capital also gets M=40", () => {
    const st = { ...ST_MULTI_NONCAP, tier: 2 };
    expect(settlementTaxAt(1, st) - settlementTaxAt(0, st)).toBe(40);
  });
  it("single-town city-state returns null (building points don't move tax)", () => {
    expect(settlementTaxAt(10, ST_SINGLE)).toBeNull();
  });
});

describe("valueBuildingDelta — channel valuation", () => {
  const base = { ...ST_MULTI_NONCAP, taxablePctBase: 0, tradePctBase: 0, baseTrade: 0, mineQtyVal: 0 };

  it("values taxable points via the tax law", () => {
    const r = valueBuildingDelta({ dTaxablePct: 5 }, base);
    expect(r.breakdown.tax).toBe(20);
    expect(r.incomeDeltaPerTurn).toBe(20);
  });

  it("single-town factions get zero tax delta from building points", () => {
    const r = valueBuildingDelta({ dTaxablePct: 10 }, { ...base, ...ST_SINGLE });
    expect(r.breakdown.tax).toBe(0);
  });

  it("values farm levels at CALIB.farmPoint (80 × 0.92) per level", () => {
    const r = valueBuildingDelta({ dFarmLevel: 2 }, base);
    expect(r.breakdown.farm).toBe(147); // round(73.6 × 2)
  });

  it("values mine points × per-region quantity value", () => {
    const r = valueBuildingDelta({ dMineSum: 4 }, { ...base, mineQtyVal: 10 });
    expect(r.breakdown.mine).toBe(200); // minePoint 5 × 4 × 10
  });

  it("scales existing trade by the trade-building multiplier (M = 1 + tradePct/10)", () => {
    const r = valueBuildingDelta({ dTradePct: 2 }, { ...base, baseTrade: 1000, tradePctBase: 0 });
    expect(r.breakdown.trade).toBe(200); // 1000 × (1.2/1.0 − 1)
  });

  it("trade delta is 0 when the settlement has no active trade to amplify", () => {
    const r = valueBuildingDelta({ dTradePct: 3 }, { ...base, baseTrade: 0 });
    expect(r.breakdown.trade).toBe(0);
  });

  it("sums all channels into incomeDeltaPerTurn", () => {
    const r = valueBuildingDelta(
      { dTaxablePct: 5, dMineSum: 4, dFarmLevel: 1 },
      { ...base, mineQtyVal: 10 });
    // 20 (tax) + 200 (mine) + 74 (farm, round 73.6) = 294
    expect(r.incomeDeltaPerTurn).toBe(294);
  });

  it("zero/negative deltas produce zero income", () => {
    expect(valueBuildingDelta({}, base).incomeDeltaPerTurn).toBe(0);
    // a negative trade point (empire-size penalty) on a trading town reduces income
    const neg = valueBuildingDelta({ dTradePct: -2 }, { ...base, baseTrade: 1000, tradePctBase: 5 });
    expect(neg.breakdown.trade).toBeLessThan(0);
  });
});

describe("paybackOf", () => {
  it("returns cost / delta to one decimal", () => {
    expect(paybackOf(1600, 200)).toBe(8);
    expect(paybackOf(1000, 300)).toBe(3.3);
  });
  it("returns null for zero or negative delta", () => {
    expect(paybackOf(1600, 0)).toBeNull();
    expect(paybackOf(1600, -5)).toBeNull();
  });
});

describe("classify — categorization + notes", () => {
  it("income buildings are economy with a breakdown note", () => {
    const c = classify({}, { tax: 20, trade: 200, mine: 0, farm: 0 }, 220);
    expect(c.category).toBe("economy");
    expect(c.note).toMatch(/tax/);
    expect(c.note).toMatch(/trade/);
  });
  it("walls with no income are military", () => {
    const c = classify({ hasWalls: true }, { tax: 0, trade: 0, mine: 0, farm: 0 }, 0);
    expect(c.category).toBe("military");
  });
  it("recruitment-only buildings are military", () => {
    const c = classify({ hasRecruit: true }, { tax: 0, trade: 0, mine: 0, farm: 0 }, 0);
    expect(c.category).toBe("military");
  });
  it("happiness/health/law buildings are happiness", () => {
    const c = classify({ hasHappiness: true }, { tax: 0, trade: 0, mine: 0, farm: 0 }, 0);
    expect(c.category).toBe("happiness");
  });
  it("an economy building with no modeled gain still reads economy with an explanatory note", () => {
    const c = classify({ category: "economy", icon: "market" }, { tax: 0, trade: 0, mine: 0, farm: 0 }, 0);
    expect(c.category).toBe("economy");
    expect(c.note).toMatch(/no modeled income/i);
  });
  it("everything else is other", () => {
    const c = classify({ icon: "government" }, { tax: 0, trade: 0, mine: 0, farm: 0 }, 0);
    expect(c.category).toBe("other");
  });
});

describe("parseConstructionCosts — EDB cost/turns/gate parsing", () => {
  const EDB = [
    "building market",
    "{",
    "\ticon trade",
    "\tlevels market trader forum",
    "\t{",
    "\t\tmarket requires factions { all, }",
    "\t\t{",
    "\t\t\tcapability",
    "\t\t\t{",
    "\t\t\ttrade_base_income_bonus bonus 1 requires factions { all, }",
    "\t\t\t}",
    "\t\t\tconstruction  2",
    "\t\t\tcost  1000",
    "\t\t\tsettlement_min town",
    "\t\t\tupgrades",
    "\t\t\t{",
    "\t\t\t\ttrader",
    "\t\t\t}",
    "\t\t}",
    "\t\ttrader requires factions { all, }",
    "\t\t{",
    "\t\t\tcapability",
    "\t\t\t{",
    "\t\t\ttrade_base_income_bonus bonus 2 requires factions { all, }",
    "\t\t\t}",
    "\t\t\tconstruction  3",
    "\t\t\tcost  2400",
    "\t\t\tsettlement_min large_town",
    "\t\t\tupgrades",
    "\t\t\t{",
    "\t\t\t\tforum",
    "\t\t\t}",
    "\t\t}",
    "\t}",
    "}",
    "building city_walls",
    "{",
    "\ticon defensive",
    "\tlevels wooden_wall stone_wall",
    "\t{",
    "\t\twooden_wall requires factions { all, }",
    "\t\t{",
    "\t\t\tcapability",
    "\t\t\t{",
    "\t\t\twall_level 1",
    "\t\t\t}",
    "\t\t\tconstruction  4",
    "\t\t\tcost  2000",
    "\t\t\tsettlement_min village",
    "\t\t\tupgrades",
    "\t\t\t{",
    "\t\t\t\tstone_wall",
    "\t\t\t}",
    "\t\t}",
    "\t}",
    "}",
  ].join("\n");

  let tmp;
  it("parses cost, construction turns, settlement_min and levels order", () => {
    tmp = path.join(os.tmpdir(), `bo_edb_${process.pid}_${Date.now()}.txt`);
    fs.writeFileSync(tmp, EDB, "latin1");
    const costs = parseConstructionCosts(tmp);
    expect(costs.market.levels).toEqual(["market", "trader", "forum"]);
    expect(costs.market.byLevel.market.cost).toBe(1000);
    expect(costs.market.byLevel.market.turns).toBe(2);
    expect(costs.market.byLevel.market.settlementMin).toBe("town");
    expect(costs.market.byLevel.trader.cost).toBe(2400);
    expect(costs.market.byLevel.trader.turns).toBe(3);
  });

  it("captures the level `requires` gate string", () => {
    const costs = parseConstructionCosts(tmp);
    expect(costs.market.byLevel.market.requires).toMatch(/factions/);
  });

  it("flags non-income capability lines (walls)", () => {
    const costs = parseConstructionCosts(tmp);
    expect(costs.city_walls.byLevel.wooden_wall.hasWalls).toBe(true);
    expect(costs.city_walls.byLevel.wooden_wall.cost).toBe(2000);
  });

  it("does NOT misread construction_cost_bonus / cost lines as build cost/turns", () => {
    // 'construction  N' and 'cost  N' only; the faction_capability *_bonus lines don't match.
    const costs = parseConstructionCosts(tmp);
    expect(costs.market.byLevel.forum).toBeUndefined(); // forum declared as upgrade target but has no block → no cost
  });
});
