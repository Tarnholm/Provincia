import { describe, test, expect } from "vitest";
import fs from "node:fs";
import {
  buildTradeRights,
  settlementFlags,
  computeTradeNetwork,
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

  test("HYPOTHESIS valuesHypothesis: all link scores in (0,1]", () => {
    let n = 0, bad = 0;
    for (const v of Object.values(r.trade.settlements)) {
      for (const score of Object.values(v.valuesHypothesis || {})) {
        n++;
        if (!(score > 0 && score <= 1)) bad++;
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
});
