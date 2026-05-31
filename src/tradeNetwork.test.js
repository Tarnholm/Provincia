import { describe, test, expect } from "vitest";
import fs from "node:fs";
import {
  buildTradeRights,
  settlementFlags,
  computeTradeNetwork,
  buildRegionGoods,
  ROAD_CHAIN,
  SEA_PORT_CHAINS,
} from "./tradeNetwork.js";

const RIS_MOD = "C:/RIS/RIS/data";
const JULII = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_julii1.sav";

describe("tradeNetwork buildTradeRights (rel199+bond6 widening)", () => {
  test("own faction always trades", () => {
    const tr = buildTradeRights(null, null);
    expect(tr("romans_julii", "romans_julii")).toBe(true);
    expect(tr("a", "b")).toBe(false);
  });

  test("bond>=54 partners (matrix `trade`) grant rights", () => {
    const diplo = { romans_julii: { trade: ["roman_senate"], allied: [] } };
    const tr = buildTradeRights(diplo, null);
    expect(tr("romans_julii", "roman_senate")).toBe(true);
    expect(tr("romans_julii", "gauls")).toBe(false);
  });

  test("allied STATE without bond (rel199+bond6) now grants rights", () => {
    // pure trade-rights/non-aggression pact: in `allied` (state==allied) but NOT
    // in `trade` (bond<54). Old gating (trade-only) missed this; now folded in.
    const diplo = { carthage: { trade: [], allied: ["numidia"] } };
    const tr = buildTradeRights(diplo, null);
    expect(tr("carthage", "numidia")).toBe(true);
  });

  test("descr_strat faction_relationships 199-ally pairs are a floor", () => {
    const strat = { romans_julii: [{ to: "samnites", kind: "ally" }, { to: "gauls", kind: "war" }] };
    const tr = buildTradeRights(null, strat);
    expect(tr("romans_julii", "samnites")).toBe(true); // ally floor
    expect(tr("romans_julii", "gauls")).toBe(false);   // war is not trade rights
  });

  test("matrix + strat floor union", () => {
    const diplo = { x: { trade: ["y"], allied: [] } };
    const strat = { x: [{ to: "z", kind: "ally" }] };
    const tr = buildTradeRights(diplo, strat);
    expect(tr("x", "y")).toBe(true);
    expect(tr("x", "z")).toBe(true);
  });
});

describe("tradeNetwork settlementFlags", () => {
  test("classifies road / sea port / river port from chains", () => {
    const seaChain = [...SEA_PORT_CHAINS][0];
    const setts = [
      { name: "A", buildings: [{ name: ROAD_CHAIN, level: 2 }, { name: seaChain, level: 1 }] },
      { name: "B", buildings: [{ name: "river_port", level: 0 }] },
      { name: "C", buildings: [] },
    ];
    const f = settlementFlags(setts);
    expect(f.A.road).toBe(true);
    expect(f.A.seaPort).toBe(true);
    expect(f.A.roadLevel).toBe(2);
    expect(f.B.seaPort).toBe(false);
    expect(f.B.riverPort).toBe(true);
    expect(f.C.road).toBe(false);
  });
});

describe("tradeNetwork buildRegionGoods (HYPOTHESIS value inputs)", () => {
  test("goodsValue = Σ(tradeValue·qty) + FARM_WEIGHT·farmLevel", () => {
    const regionResources = {
      Roma: [{ type: "wine", qty: 4, tradeValue: 1 }, { type: "purple_dye", qty: 2, tradeValue: 3 }],
      Bare: [],
    };
    const regionFarm = { Roma: 11, Bare: 6, FarmOnly: 8 };
    const g = buildRegionGoods(regionResources, regionFarm);
    // Roma: 1*4 + 3*2 = 10 resource sum, + 0.5*11 = 5.5 farm → 15.5
    expect(g.Roma.resourceTradeSum).toBe(10);
    expect(g.Roma.farmLevel).toBe(11);
    expect(g.Roma.goodsValue).toBeCloseTo(15.5, 5);
    expect(g.Roma.resources).toEqual(["wine", "purple_dye"]);
    // Bare: no resources, farm 6 → 3
    expect(g.Bare.goodsValue).toBeCloseTo(3, 5);
    // FarmOnly: farm present, no resource placements → 0.5*8 = 4
    expect(g.FarmOnly.goodsValue).toBeCloseTo(4, 5);
  });

  test("missing farm level contributes nothing (no fabrication)", () => {
    const g = buildRegionGoods({ X: [{ type: "iron", qty: 1, tradeValue: 1 }] }, {});
    expect(g.X.farmLevel).toBe(null);
    expect(g.X.goodsValue).toBe(1);
  });
});

// Live-mod integration (dev box only) — gated on file existence.
const liveOk = fs.existsSync(RIS_MOD) && fs.existsSync(JULII);
describe.runIf(liveOk)("tradeNetwork integration (live RIS + julii1 save)", () => {
  const r = liveOk ? computeTradeNetwork(fs.readFileSync(JULII), RIS_MOD) : null;

  test("computes geometry + trade with sane stats", () => {
    expect(r.stats.regions).toBeGreaterThan(100);
    expect(r.stats.seaBodies).toBeGreaterThan(1);
    expect(r.stats.withRoad).toBeGreaterThan(0);
    expect(r.stats.withSeaPort).toBeGreaterThan(0);
  });

  test("sea routes only connect ports on the SAME connected sea body", () => {
    // Syracuse (Sicily) and Carthage share the Mediterranean → same body.
    const seasOf = (city) => new Set(r.geometry.regionSeas[r.settlement2region[city]] || []);
    const med = seasOf("Syracuse");
    const carth = seasOf("Carthage");
    expect([...carth].some((s) => med.has(s))).toBe(true); // share Mediterranean
    // Atlantic (Gades) and Black Sea (Sinope) share NO body.
    const atlantic = seasOf("Gades");
    const black = seasOf("Sinope");
    expect([...black].some((s) => atlantic.has(s))).toBe(false);
  });

  test("HYPOTHESIS valuesHypothesis: all link scores finite, >0, bounded", () => {
    // Refined value = baseDecay(≤1) × goods(≤~1.6) × pop(≤~1.5) × infra(≤1.25),
    // so a link can exceed 1 but is bounded well under ~3.2. Relative-only.
    let n = 0, bad = 0;
    for (const v of Object.values(r.trade.settlements)) {
      for (const score of Object.values(v.valuesHypothesis || {})) {
        n++;
        if (!(Number.isFinite(score) && score > 0 && score < 3.2)) bad++;
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toBe(0);
  });

  test("HYPOTHESIS: every connectivity partner has a value entry", () => {
    for (const v of Object.values(r.trade.settlements)) {
      for (const p of v.partners) expect(v.valuesHypothesis[p]).toBeGreaterThan(0);
    }
  });

  test("HYPOTHESIS: trade goods + population inputs are populated", () => {
    expect(r.stats.regionsWithGoods).toBeGreaterThan(100);
    expect(r.stats.settlementsWithPopulation).toBeGreaterThan(100);
    // Rome carries placed trade goods + a farm level + a goods value.
    const rome = r.trade.settlements["Rome"];
    expect(rome.resources.length).toBeGreaterThan(0);
    expect(rome.farmLevel).toBeGreaterThan(0);
    expect(rome.goodsValueHypothesis).toBeGreaterThan(0);
  });

  test("HYPOTHESIS: per-settlement tradeScore is finite & relative; topPartners well-formed", () => {
    let scored = 0;
    for (const v of Object.values(r.trade.settlements)) {
      expect(Number.isFinite(v.tradeScoreHypothesis)).toBe(true);
      expect(v.tradeScoreHypothesis).toBeGreaterThanOrEqual(0);
      // topPartners must be a subset of partners, sorted descending by value.
      let prev = Infinity;
      for (const tp of v.topPartnersHypothesis) {
        expect(v.partners).toContain(tp.partner);
        expect(tp.value).toBeLessThanOrEqual(prev);
        prev = tp.value;
      }
      if (v.tradeScoreHypothesis > 0) scored++;
    }
    expect(scored).toBeGreaterThan(0);
  });

  test("HYPOTHESIS sanity: a big coastal trade hub outscores an isolated inland minor", () => {
    // Rome (pop ~9000, road+port, rich goods) must outscore any 0-partner inland.
    const rome = r.trade.settlements["Rome"];
    const isolated = Object.values(r.trade.settlements)
      .filter((v) => v.partners.length === 0 && !v.seaPort);
    expect(rome.tradeScoreHypothesis).toBeGreaterThan(10);
    for (const iso of isolated) expect(rome.tradeScoreHypothesis).toBeGreaterThan(iso.tradeScoreHypothesis);
  });
});
