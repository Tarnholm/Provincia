// src/growthModel.js
//
// STRAT-ONLY base-growth estimator (2026-06-08). Computes each settlement's
// per-turn population growth at NORMAL tax purely from the mod files (descr_strat
// buildings + population, descr_regions fertility) — NO save required — so the
// Army Setup tax plan can offer a no-save PREVIEW for any faction.
//
// ⚠ ACCURACY: this is a ROUGH ESTIMATE (~55-60% exact bracket match, validated
// against Carthage 41 + Julii 26 all-Normal turn-2 saves). It is NOT the exact
// plan. For an exact plan (proven 67/67) load an all-Normal turn-2 save of the
// faction — see armySetup.optimalTaxPlan. The reasons it can't be exact from the
// strat are documented and real (see WHY below); callers MUST label results as an
// estimate and never present them as authoritative ([[provincia-no-fallbacks]]).
//
// MODEL (each term in % growth/turn, at Normal tax):
//   base_growth ≈ 0.5×FarmN                 region fertility (descr_regions FarmN; CONFIRMED FarmN×0.5)
//               − (pop/1500 − 0.5)          squalor baseline (CONFIRMED on ungoverned towns)
//               + C0 + Cf·farmLevel + Ch·healthLevel + Cg·govLevel
//                                            calibrated building residual (the fertility
//                                            "overcrowding" penalty ≈ −0.5×FarmN folds into C0)
//   optimal bracket = highest of {low,normal,high,very_high} keeping
//                     base_growth + taxMod ≥ 0   (taxMod = +0.5/0/−0.5/−1.0)
//
// WHY it can't be exact from the strat (all verified 2026-06-08):
//   1. GOVERNOR EFFECTS need the governor. Every settlement has a governor whose
//      traits shift growth: `Effect Farming`/`Fertility` → farm catalyst, `Effect
//      Health` → health catalyst, and `Effect Squalor N` → −0.5×N% growth (CONFIRMED
//      Larinum 2026-06-09: an Estates `large Estate` governor = Effect Squalor +2 →
//      −1.0% growth; remove him → squalor falls to the pop baseline). These are now
//      applied EXACTLY when the governor's traits are known (loaded save → traitEffects
//      .govEffectByCityFromSave). They can't be read from descr_strat alone for the
//      no-save preview (seeded generals aren't explicitly bound to a settlement), which
//      is the main reason the no-save estimate still scatters ±0.5-1.0% on those towns.
//   2. FERTILITY/OVERCROWDING COUPLING: base farming (+FarmN×0.5) is largely
//      cancelled by an engine overcrowding penalty that also scales with the
//      farming level, so FarmN's NET effect ≈ 0 (adding it explicitly made the
//      fit WORSE). The split isn't recoverable from static files.
//   3. SQUALOR is multi-input (population tier + government building + governor
//      traits/ancillaries) — the pop term is clean (pop/1500−0.5) but the rest is
//      governor-dependent (see #1).
// These are engine-internal; an all-Normal turn-2 save bakes all of them into the
// stored growth, which is why the save path is exact and this estimate is not.

"use strict";

const fs = require("fs");
const path = require("path");

// Calibrated coefficients (fit to Carthage+Julii all-Normal turn-2 base growth,
// 67 settlements). The govLevel coefficient is noisy (correlates with city size);
// these reproduce ~60% of brackets exactly and ~67% within 0.5%.
const COEF = { c0: -4.266, farm: 0.176, health: 1.097, gov: 0.540 };
const ACCURACY = { bracketMatch: 0.60, within0p5: 0.67, n: 67, note: "rough estimate — load an all-Normal turn-2 save for the exact plan" };

const TAX_MOD = { low: 0.5, normal: 0.0, high: -0.5, very_high: -1.0 };
const BRACKET_ORDER = ["low", "normal", "high", "very_high"];

// Building-name → level within its chain (RIS farm + health + government chains).
const FARM_LEVEL = {
  irrigation_ditches: 1, basin_irrigation: 2, canal_network: 3, irrigation_aquaducts: 4, great_estates: 5,
  shifting_cultivation_fields: 1, slash_and_burn: 2, rotational_grove_fields: 3, deforestation_efforts: 4, reclaimed_estates: 5,
  drainage_canals: 1, reclamation_dike: 2, polder_system: 3, imperial_drainage: 4, great_polders: 5,
};
const HEALTH_LEVEL = { cisterns: 1, sewers: 2, baths: 3, aqueduct: 4, city_plumbing: 5 };
const GOV_LEVEL = { governors_house: 1, governors_villa: 2, governors_palace: 3, proconsuls_palace: 4, imperial_palace: 5 };

function findDescrStrat(modDataDir) {
  for (const c of [
    ["world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"],
    ["world", "maps", "campaign", "alexander", "descr_strat.txt"],
    ["world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"],
  ]) { const p = path.join(modDataDir, ...c); if (fs.existsSync(p)) return p; }
  return null;
}

// settlement name → region FarmN (from descr_regions hidden_resources)
function parseRegionFertility(modDataDir) {
  const p = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt");
  const out = {};
  if (!fs.existsSync(p)) return out;
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  let blk = [];
  const flush = () => {
    if (blk.length >= 6) {
      const region = (blk[0] || "").trim();   // region NAME (descr_strat `region` field)
      const settle = (blk[1] || "").trim();   // settlement NAME
      const m = (blk[5] || "").match(/Farm(\d+)/i);
      if (m) { if (region) out[region] = +m[1]; if (settle) out[settle] = +m[1]; }
    }
    blk = [];
  };
  for (const ln of lines) {
    if (/^[A-Za-z]/.test(ln) && !/^\s/.test(ln)) { flush(); blk = [ln]; }
    else if (blk.length) blk.push(ln);
  }
  flush();
  return out;
}

// Estimate base growth (%/turn at Normal) for one settlement.
//   farmN = region fertility tier; pop = population; buildings = ["chain:level", ...]
function estimateBaseGrowth(farmN, pop, buildings) {
  const farmL = levelFromBuildings(buildings, FARM_LEVEL);
  const healthL = levelFromBuildings(buildings, HEALTH_LEVEL);
  const govL = levelFromBuildings(buildings, GOV_LEVEL);
  const squalor = Math.max(0, pop / 1500 - 0.5);
  const g = 0.5 * (farmN || 0) - squalor + COEF.c0 + COEF.farm * farmL + COEF.health * healthL + COEF.gov * govL;
  // snap to 0.5% (RTW growth steps)
  return Math.round(g * 2) / 2;
}

// scan a settlement's building level tokens for the highest level present in `table`
function levelFromBuildings(buildings, table) {
  let best = 0;
  for (const b of buildings) {
    const lvl = b.includes(":") ? b.split(":")[1] : b;
    if (table[lvl] != null && table[lvl] > best) best = table[lvl];
  }
  return best;
}

function optimalBracketForBase(baseGrowth) {
  for (let i = BRACKET_ORDER.length - 1; i >= 0; i--) {
    const b = BRACKET_ORDER[i];
    if (baseGrowth + TAX_MOD[b] >= -1e-9) return b;
  }
  return "low";
}

// Per-faction strat-only tax plan. As of 2026-06-08 this DELEGATES to the EDB-based
// growthEval (the real RIS growth model evaluated from the mod files), which is far
// more accurate than the old coefficient estimate below (~82% within 0.5% / ~68%
// exact bracket out-of-sample, vs ~60%). The old estimateBaseGrowth path is kept only
// as a fallback if growthEval can't load. Returns
// { estimated:true, accuracy, byFaction:{fac:{settlements:[{region,pop,baseGrowthEst,optimalBracket}]}} }
function computeStratTaxPlan(modDataDir, faction, opts) {
  try {
    const gv = require("./growthEval.js");
    const r = gv.computeFactionGrowth(modDataDir, faction, opts);
    if (r && !r.error && r.settlements) {
      return {
        estimated: true, accuracy: r.accuracy, saveAware: !!r.saveAware,
        byFaction: { [r.faction]: { settlements: r.settlements.map(s => ({
          region: s.region, settlement: s.settlement, pop: s.pop, farmN: s.features && s.features.farmN,
          baseGrowthEst: s.baseGrowthEst, optimalBracket: s.optimalBracket, savedDev: !!s.savedDev,
          borderline: !!s.borderline, distToBoundary: s.distToBoundary, components: s.components,
        })) } },
      };
    }
  } catch (e) { /* fall through to legacy estimate */ }
  return computeStratTaxPlanLegacy(modDataDir, faction);
}

// Legacy ~60% coefficient estimate (fallback only).
function computeStratTaxPlanLegacy(modDataDir, faction) {
  const p = findDescrStrat(modDataDir);
  if (!p) return { error: "descr_strat not found" };
  const fert = parseRegionFertility(modDataDir);
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  const want = faction ? String(faction).toLowerCase() : null;
  const byFaction = {};
  let curFac = null, curSettle = null;
  const pushSettle = () => {
    if (curFac && curSettle && curSettle.region) {
      const fac = curFac.toLowerCase();
      if (!want || fac === want) {
        const farmN = fert[curSettle.region] || 0;
        const base = estimateBaseGrowth(farmN, curSettle.pop || 0, curSettle.buildings);
        (byFaction[fac] = byFaction[fac] || { settlements: [] }).settlements.push({
          region: curSettle.region, pop: curSettle.pop, farmN,
          baseGrowthEst: base, optimalBracket: optimalBracketForBase(base),
        });
      }
    }
    curSettle = null;
  };
  for (const ln of lines) {
    const fm = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (fm) { pushSettle(); curFac = fm[1]; continue; }
    if (/^settlement\b/.test(ln)) { pushSettle(); curSettle = { region: null, pop: 0, buildings: [] }; continue; }
    if (curSettle) {
      const rg = ln.match(/^\s*region\s+([\w-]+)/); if (rg) curSettle.region = rg[1];
      const pp = ln.match(/^\s*population\s+(\d+)/); if (pp) curSettle.pop = +pp[1];
      const bt = ln.match(/^\s*type\s+(\w+)\s+(\w+)/); if (bt) curSettle.buildings.push(bt[1] + ":" + bt[2]);
    }
  }
  pushSettle();
  return { estimated: true, accuracy: ACCURACY, byFaction };
}

module.exports = {
  estimateBaseGrowth, optimalBracketForBase, computeStratTaxPlan,
  parseRegionFertility, findDescrStrat,
  COEF, ACCURACY, TAX_MOD, FARM_LEVEL, HEALTH_LEVEL, GOV_LEVEL,
};
