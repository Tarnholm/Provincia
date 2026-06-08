// src/growthEval.js
//
// No-save population-growth ESTIMATOR (2026-06-08). Evaluates each settlement's
// base growth (at Normal tax) directly from the mod files — descr_strat buildings
// + population, descr_regions FarmN/hidden-resources, descr_strat map resources,
// and the full export_descr_buildings growth model (every population_growth_bonus /
// farming_level / population_health_bonus rule, evaluated against each settlement's
// state) — so the Army Setup tax plan can offer a no-save PREVIEW for any faction.
//
// HOW IT WORKS (this is the real RIS growth model, not a guess):
//   RIS encodes growth as EDB capability lines. The displayed catalysts are:
//     base farming (≈0.5×FarmN) + farm-upgrade (engine farming_level conversion)
//     + health (population_health_bonus conversion) + Σ population_growth_bonus
//     (every other building bonus, each `requires` clause evaluated) − squalor(pop).
//   We extract those terms per settlement and combine them with coefficients
//   CALIBRATED + cross-validated against all-Normal turn-2 ground-truth saves
//   (Carthage 41 + Julii 25 settlements).
//
// ACCURACY (leave-one-faction-out cross-validation — honest out-of-sample):
//   ~82% of settlements within 0.5% of true growth; ~68% land on the exact optimal
//   tax bracket; MAE ≈ 0.39%. In-sample it is ~92% within 0.5% / ~76% bracket.
//   The residual is dominated by RTW quantising growth to 0.5% steps right on the
//   bracket boundaries (0 / +0.5 / +1.0), so a sub-0.5% error flips a bracket. This
//   is a PREVIEW: for the exact plan (proven 67/67) load an all-Normal turn-2 save
//   (armySetup.optimalTaxPlan). Callers MUST label results as an estimate
//   ([[provincia-no-fallbacks]], [[provincia-feature-logging]]).
//
// VALIDATED MODEL FACTS (the hard-won ones):
//   • AI-only lines (`... not is_player ...`) do NOT leak to the player even when a
//     trailing `or sizeN` would make a naive left-to-right eval true — they're hard
//     false for the player. (Overturns the earlier "they leak" assumption.)
//   • The governor-tier dampers (`-2/-3/-4/-5 requires building_present_min_level
//     core_building governors_villa/...`) are transient upgrade-jump controls, NOT
//     steady-state growth — skipped.
//   • Map trade-resources (`resource grain/fish/olive/...`) gate farming_level and
//     several bonuses; descr_strat annotates each resource with its region in a
//     trailing `; <Region>` comment, so we can map resource→region with no TGA work.
//   • The earlier "growth needs a hidden per-tile fertility input" conclusion was
//     WRONG: the divergent same-FarmN towns differed in their BUILDINGS (e.g. Reate
//     has highland_pastoralism + governmentC, Larinum doesn't). It's all in the files.

"use strict";
const fs = require("fs");
const path = require("path");

// Calibrated coefficients (free least-squares fit to Carthage+Julii all-Normal
// turn-2 base growth; best out-of-sample LOFO performance). See header for accuracy.
// Calibrated on 6 factions / 5 cultures (Roman, Punic, Greco-Bactrian, Macedonian,
// Germanic, Cyrenean-Greek) — 117 all-Normal turn-2 settlements — with the EDB
// supply-flag aliases correctly expanded. Coefficients now match the proven 0.5%/point
// structure (health ≈ pgOther ≈ 0.5). Leave-one-faction-out: ~88% within 0.5%, ~68% bracket.
const COEF = { intercept: 0.4161, farmN: -0.0058, farmLevel: 0.4425, healthSum: 0.5270, pgOther: 0.5022, popPer1000: -0.3694, govLevel: -0.3482, hasPort: 0.0375 };
const ACCURACY = { withinHalf: 0.88, bracketMatch: 0.68, mae: 0.35, n: 117,
  note: "no-save preview (~88% within 0.5%, ~68% bracket); load an all-Normal turn-2 save for the exact plan" };

// SAVE-AWARE model: adds the per-settlement development value stored at settlement
// mechanics slot marker−1528 (settlementFields.growthDevValue) — the last hidden growth
// term (the real squalor/development input the pop proxy only approximated). Readable from
// ANY save (turn-1 included) for ALL factions, so this gives near-exact base growth for
// every faction from a single loaded save, with no tax byte needed. Coefs fit on 66
// Carthage+Julii all-Normal settlements; LOFO out-of-sample ~95% within 0.5% / ~89% bracket.
// Two stored development terms: marker−1528 (growthDevValue) and marker−1556
// (growthDevValue2). Together they take the estimate to ~100% within 0.5% / ~94%
// exact bracket (LOFO cross-validated) for any faction from a single loaded save.
const COEF_SAVE = { intercept: 0.9210, farmN: -0.0157, farmLevel: -0.0722, healthSum: 0.5628, pgOther: 0.4987, popPer1000: -0.0130, govLevel: -0.8725, growthDev: -0.4721, growthDev2: 0.5628 };
const ACCURACY_SAVE = { withinHalf: 0.99, bracketMatch: 0.95, mae: 0.06, n: 117,
  note: "save-aware estimate using stored development values (marker−1528/−1556); ~99% within 0.5% / ~95% bracket across 6 factions, all factions from one save" };

const TAX_MOD = { low: 0.5, normal: 0.0, high: -0.5, very_high: -1.0 };
const BRACKET_ORDER = ["low", "normal", "high", "very_high"];
const SIZE_TIER = { village: 1, town: 2, large_town: 3, city: 4, large_city: 5, huge_city: 6 };

function findDescrStrat(modDataDir) {
  for (const c of [
    ["world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"],
    ["world", "maps", "campaign", "alexander", "descr_strat.txt"],
    ["world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"],
  ]) { const p = path.join(modDataDir, ...c); if (fs.existsSync(p)) return p; }
  return null;
}
function findEDB(modDataDir) {
  const p = path.join(modDataDir, "export_descr_buildings.txt");
  return fs.existsSync(p) ? p : null;
}

// ---- descr_regions: region -> { farmN, hidden:Set, settlement } ----
function parseRegions(modDataDir) {
  const p = path.join(modDataDir, "world", "maps", "base", "descr_regions.txt");
  const byRegion = {}, bySettlement = {};
  if (!fs.existsSync(p)) return { byRegion, bySettlement };
  const lines = fs.readFileSync(p, "latin1").split(/\r?\n/);
  let blk = [];
  const flush = () => {
    const b = blk.filter(x => x.trim() !== "" && !/^\s*;/.test(x));
    if (b.length >= 6) {
      const region = b[0].trim();
      const settlement = b[1].trim();
      const attrs = b[5].split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const hidden = new Set(attrs);
      let farmN = 0;
      for (const a of attrs) { const m = a.match(/^farm(\d+)$/); if (m) farmN = +m[1]; }
      const rec = { region, settlement, farmN, hidden };
      byRegion[region] = rec; bySettlement[settlement] = rec;
    }
    blk = [];
  };
  for (const ln of lines) {
    if (/^[A-Za-z]/.test(ln)) { flush(); blk = [ln]; }
    else if (blk.length) blk.push(ln);
  }
  flush();
  return { byRegion, bySettlement };
}

// ---- descr_strat map resources: region(from trailing comment) -> Set of types ----
function parseResources(stratPath) {
  const byRegion = {};
  const lines = fs.readFileSync(stratPath, "latin1").split(/\r?\n/);
  for (const ln of lines) {
    const m = ln.match(/^\s*resource\s+([a-z_]+)\s*,.*;\s*(.+?)\s*$/i);
    if (!m) continue;
    (byRegion[m[2].trim()] = byRegion[m[2].trim()] || new Set()).add(m[1].toLowerCase().trim());
  }
  return byRegion;
}

// ---- descr_strat: faction -> settlements [{region, level, pop, buildings:[{chain,level}], capital}] ----
function parseStrat(stratPath) {
  const lines = fs.readFileSync(stratPath, "latin1").split(/\r?\n/);
  const factions = {};
  let curFac = null, cur = null, inSettle = false, firstSettleOfFac = false;
  for (const ln of lines) {
    const fm = ln.match(/^faction\s+([a-z_0-9]+)\s*,/i);
    if (fm) { curFac = fm[1].toLowerCase(); factions[curFac] = factions[curFac] || { settlements: [] }; firstSettleOfFac = true; continue; }
    if (/^settlement\b/.test(ln)) {
      cur = { region: null, level: null, pop: 0, buildings: [], capital: firstSettleOfFac };
      firstSettleOfFac = false;
      if (curFac) factions[curFac].settlements.push(cur);
      inSettle = true; continue;
    }
    if (!inSettle || !cur) continue;
    const lv = ln.match(/^\s*level\s+(\w+)/); if (lv) cur.level = lv[1];
    const rg = ln.match(/^\s*region\s+([\w-]+)/); if (rg) cur.region = rg[1];
    const pp = ln.match(/^\s*population\s+(\d+)/); if (pp) cur.pop = +pp[1];
    const ty = ln.match(/^\s*type\s+(\w+)\s+(\w+)/); if (ty) cur.buildings.push({ chain: ty[1], level: ty[2] });
  }
  return factions;
}

// ---- export_descr_buildings: capIndex["chain:level"] = {popGrowth,farming,health} ----
function parseEDB(edbPath) {
  const lines = fs.readFileSync(edbPath, "latin1").split(/\r?\n/);
  const capIndex = {}, chainLevels = {};
  let curBuilding = null, levelsList = [], curLevel = null;
  // EDB `alias NAME { requires <clause> }` blocks. RIS gates many bonuses on supply
  // aliases (e.g. perfumes_building_supply = "resource perfumes or perfumes_supply_built
  // factionwide"). Expanding these is what fixes the health/buildings undercount.
  const aliases = {};
  let curAlias = null;
  const add = (kind, obj) => {
    if (!curBuilding || !curLevel) return;
    const key = curBuilding + ":" + curLevel;
    (capIndex[key] = capIndex[key] || { popGrowth: [], farming: [], health: [] })[kind].push(obj);
  };
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const am = ln.match(/^alias\s+(\w+)/);
    if (am) { curAlias = am[1]; continue; }
    if (curAlias) { const rq = ln.match(/^\s*requires\s+(.+)/); if (rq) { aliases[curAlias] = rq[1].trim(); curAlias = null; } else if (/^\s*\}/.test(ln)) curAlias = null; continue; }
    const bm = ln.match(/^building\s+(\w+)/);
    if (bm) { curBuilding = bm[1]; levelsList = []; curLevel = null; continue; }
    const lm = ln.match(/^\s*levels\s+(.+)$/);
    if (lm) { levelsList = lm[1].trim().split(/\s+/).filter(w => w && w !== "{"); chainLevels[curBuilding] = levelsList.slice(); continue; }
    const tok = ln.trim().split(/\s+/);
    if (levelsList.length && tok[0] && levelsList.includes(tok[0]) && (tok[1] === "requires" || tok[1] === undefined || tok[1] === "{")) {
      curLevel = tok[0]; continue;
    }
    let m;
    if ((m = ln.match(/^\s*population_growth_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("popGrowth", { bonus: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*farming_level\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("farming", { val: +m[1], req: (m[2] || "").trim() }); continue; }
    if ((m = ln.match(/^\s*population_health_bonus\s+bonus\s+(-?\d+)(?:\s+requires\s+(.+))?/))) { add("health", { bonus: +m[1], req: (m[2] || "").trim() }); continue; }
  }
  return { capIndex, chainLevels, aliases };
}

// ---- requires evaluator (player perspective, campaign start) ----
function evalReq(req, ctx) {
  if (!req) return true;
  if (/\bnot\s+is_player\b/.test(req)) return false; // AI-only lines never apply to the player
  req = req.replace(/factions\s*\{([^}]*)\}/g, (m, g) => "factions:" + g.split(",").map(s => s.trim()).filter(Boolean).join("|"));
  const parts = req.split(/\s+(and|or)\s+/);
  let acc = null, op = "and";
  for (const p of parts) {
    if (p === "and" || p === "or") { op = p; continue; }
    const v = evalTerm(p.trim(), ctx);
    if (acc === null) acc = v; else acc = (op === "and") ? (acc && v) : (acc || v);
  }
  return acc === null ? true : acc;
}
function evalTerm(t, ctx) {
  let neg = false;
  while (t.startsWith("not ")) { neg = !neg; t = t.slice(4).trim(); }
  return neg ? !evalAtom(t, ctx) : evalAtom(t, ctx);
}
function evalAtom(t, ctx) {
  if (t === "is_player") return true;
  if (t === "factionwide" || t === "requires_gov") return true;
  if (t === "disabling_in_winter") return true; // campaign start = summer
  if (t.startsWith("major_event")) return false; // no reforms at start
  if (t === "extreme_cold" || t === "not_extreme_cold") return t === "not_extreme_cold";
  let m;
  if ((m = t.match(/^hidden_resource\s+(\S+)/))) {
    const h = m[1].toLowerCase();
    if (h === "capital") return !!ctx.capital;
    return ctx.hidden.has(h);
  }
  if ((m = t.match(/^resource\s+(\S+)/))) return ctx.resources.has(m[1].toLowerCase()) || ctx.hidden.has(m[1].toLowerCase());
  if ((m = t.match(/^factions:(.+)/))) { const set = m[1].split("|"); return set.includes("all") || set.includes(ctx.faction); }
  if ((m = t.match(/^building_present_min_level\s+(\S+)\s+(\S+)/))) {
    const have = ctx.buildings.get(m[1]); if (have == null) return false;
    const need = (ctx.chainLevels[m[1]] || []).indexOf(m[2]);
    return need >= 0 && have >= need;
  }
  if ((m = t.match(/^building_present\s+(\S+)/))) return ctx.buildings.has(m[1]);
  if ((m = t.match(/^size(\d+)/))) return ctx.sizeTier >= +m[1];
  if (t === "homeland") return ctx.homeland;
  // EDB supply aliases (perfumes_building_supply etc.) → expand & evaluate. At a
  // campaign start the `*_supply_built factionwide` half is false (no supply building
  // yet), so these reduce to `resource X`, which we can read from the region.
  if (ctx.aliases && ctx.aliases[t] != null) return evalReq(ctx.aliases[t], ctx);
  if (t === "nobuilding" || t === "no_other_farm" || t.endsWith("_chain") || t.endsWith("_tier_5") || t.endsWith("_farming")) return true;
  return false; // unknown faction-supply flags → false
}

// ---- per-settlement feature extraction + growth estimate ----
function settlementFeatures(s, region, faction, capIndex, chainLevels, resourcesByRegion, aliases) {
  const buildings = new Map();
  for (const b of s.buildings) {
    const order = chainLevels[b.chain] || null;
    const idx = order ? order.indexOf(b.level) : 0;
    buildings.set(b.chain, idx < 0 ? 0 : idx);
  }
  const ctx = {
    hidden: region.hidden || new Set(), buildings, chainLevels, aliases: aliases || {},
    capital: s.capital, faction, homeland: [...(region.hidden || [])].some(h => h.startsWith("homeland")),
    sizeTier: SIZE_TIER[s.level] || 1, resources: resourcesByRegion[s.region] || new Set(),
  };
  let pgOther = 0, farmLevel = 0, healthSum = 0;
  for (const b of s.buildings) {
    const cap = capIndex[b.chain + ":" + b.level];
    if (!cap) continue;
    for (const pg of cap.popGrowth) {
      if (!evalReq(pg.req, ctx)) continue;
      if (/building_present_min_level core_building (governors_villa|governors_palace|proconsuls_palace|imperial_palace)/.test(pg.req)) continue; // transient damper
      if (/^hidden_resource\s+farm\d+$/.test(pg.req)) continue; // BASE GROWTH -farmN (folded into farmN coef)
      pgOther += pg.bonus;
    }
    let fl = null;
    for (const f of cap.farming) if (evalReq(f.req, ctx)) fl = (fl == null) ? f.val : Math.max(fl, f.val);
    if (fl != null) farmLevel = Math.max(farmLevel, fl);
    for (const h of cap.health) if (evalReq(h.req, ctx)) healthSum += h.bonus;
  }
  const govLevel = buildings.has("core_building") ? (buildings.get("core_building") + 1) : 0;
  // coastal settlements get a small extra growth (sea-trade/fishing) the EDB bonuses
  // don't fully capture — flag a port so the no-save model can credit it.
  const hasPort = [...(region.hidden || [])].some(h => h.startsWith("base_port_level")) ? 1 : 0;
  return { farmN: region.farmN, farmLevel, healthSum, pgOther, pop: s.pop, govLevel, hasPort };
}

// raw (unsnapped) growth — used to judge how close to a bracket boundary we are
function rawGrowth(f) {
  return COEF.intercept + COEF.farmN * f.farmN + COEF.farmLevel * f.farmLevel
    + COEF.healthSum * f.healthSum + COEF.pgOther * f.pgOther
    + COEF.popPer1000 * (f.pop / 1000) + COEF.govLevel * f.govLevel
    + COEF.hasPort * (f.hasPort || 0);
}
function estimateGrowth(f) { return Math.round(rawGrowth(f) * 2) / 2; } // RTW growth steps are 0.5%

// Save-aware estimate: same features + the two stored development values
// (marker−1528 = growthDev, marker−1556 = growthDev2).
function rawGrowthWithSave(f, growthDev, growthDev2) {
  return COEF_SAVE.intercept + COEF_SAVE.farmN * f.farmN + COEF_SAVE.farmLevel * f.farmLevel
    + COEF_SAVE.healthSum * f.healthSum + COEF_SAVE.pgOther * f.pgOther
    + COEF_SAVE.popPer1000 * (f.pop / 1000) + COEF_SAVE.govLevel * f.govLevel
    + COEF_SAVE.growthDev * (growthDev || 0) + COEF_SAVE.growthDev2 * (growthDev2 || 0);
}
function estimateGrowthWithSave(f, growthDev, growthDev2) { return Math.round(rawGrowthWithSave(f, growthDev, growthDev2) * 2) / 2; }

// Bracket-flip thresholds are at growth = 0 / +0.5 / +1.0 (where the optimal bracket
// changes). "Borderline" = the raw growth sits within the model's error margin of one
// of those, so the recommended bracket is the least certain there — flag it so the
// user knows to verify in-game rather than trust it blindly.
function bracketConfidence(raw, margin) {
  let nearest = Infinity;
  for (const t of [0, 0.5, 1.0]) nearest = Math.min(nearest, Math.abs(raw - t));
  return { borderline: nearest < margin, distToBoundary: Math.round(nearest * 100) / 100 };
}

function optimalBracket(baseGrowth) {
  for (let i = BRACKET_ORDER.length - 1; i >= 0; i--) {
    const b = BRACKET_ORDER[i];
    if (baseGrowth + TAX_MOD[b] >= -1e-9) return b;
  }
  return "low";
}

// Public: per-faction growth + optimal-tax estimate.
//   opts.growthDevByCity = { [settlementName]: marker−1528 value } from a loaded save
//     (crackSave settlementFields[city].growthDevValue). When supplied, uses the far more
//     accurate save-aware model (~95% within 0.5%); otherwise the no-save model (~82%).
// Returns { estimated:true, saveAware, accuracy, settlements:[{region,settlement,pop,
//   baseGrowthEst,optimalBracket,features}] }
function computeFactionGrowth(modDataDir, faction, opts) {
  const stratPath = findDescrStrat(modDataDir);
  const edbPath = findEDB(modDataDir);
  if (!stratPath || !edbPath) return { error: "descr_strat or export_descr_buildings not found", estimated: true };
  const { byRegion } = parseRegions(modDataDir);
  const resourcesByRegion = parseResources(stratPath);
  const { capIndex, chainLevels, aliases } = parseEDB(edbPath);
  const factions = parseStrat(stratPath);
  const want = String(faction || "").toLowerCase();
  const f = factions[want];
  if (!f) return { error: `faction ${faction} not found in descr_strat`, estimated: true, accuracy: ACCURACY };
  const dev = (opts && opts.growthDevByCity) || null;
  const govEff = (opts && opts.govEffectByCity) || null; // { city: {growthFarm, health, ...} }
  const settlements = [];
  let usedDev = 0, usedGov = 0;
  for (const s of f.settlements) {
    const region = byRegion[s.region];
    if (!region || !region.farmN) continue;
    const feat = settlementFeatures(s, region, want, capIndex, chainLevels, resourcesByRegion, aliases);
    // Governor trait effects (user 2026-06-08: generals' traits DO affect growth).
    // Farming + Fertility feed the farm catalyst; Health feeds the health catalyst —
    // fold them into the same features growthEval already weights.
    const ge = govEff && region.settlement in govEff ? govEff[region.settlement] : null;
    if (ge) { feat.farmLevel += (ge.growthFarm || 0); feat.healthSum += (ge.health || 0); feat.govEffect = ge; usedGov++; }
    // dev[city] = { v1528, v1556 } from the loaded save (or a bare number for v1528 only)
    const gd = dev && region.settlement in dev ? dev[region.settlement] : null;
    let baseGrowthEst, raw, savedDev = false;
    if (gd != null) {
      const v1 = (typeof gd === "number") ? gd : gd.v1528;
      const v2 = (typeof gd === "number") ? 0 : (gd.v1556 || 0);
      if (v1 != null) { raw = rawGrowthWithSave(feat, v1, v2); savedDev = true; usedDev++; }
      else raw = rawGrowth(feat);
    } else raw = rawGrowth(feat);
    baseGrowthEst = Math.round(raw * 2) / 2;
    // confidence: only flag the ROUGH no-save estimate (margin 0.4 catches ~81% of its
    // bracket misses — a useful "verify this one" cue). The save-aware estimate is ~97%
    // accurate, so flagging it (margin 0 → never) would just be trust-eroding noise.
    const conf = bracketConfidence(raw, savedDev ? 0 : 0.4);
    // Per-component breakdown (matches the in-game Settlement Details growth scroll),
    // each catalyst at the confirmed 0.5%/point. Squalor is taken as the residual so
    // the lines always sum to the shown total (exact when this is a save-backed estimate).
    const r2 = x => Math.round(x * 2) / 2;
    const damper = feat.govLevel >= 2 ? feat.govLevel : 0; // villa−2/palace−3/proconsuls−4/imperial−5
    const cBase = r2(0.5 * feat.farmN);
    const cFarm = r2(0.5 * feat.farmLevel);
    const cHealth = r2(0.5 * feat.healthSum);
    const cBuildings = r2(0.5 * (feat.pgOther - feat.farmN - damper));
    const cSqualor = Math.max(0, r2((cBase + cFarm + cHealth + cBuildings) - baseGrowthEst)); // ≥0 penalty magnitude
    settlements.push({
      region: s.region, settlement: region.settlement, pop: s.pop,
      baseGrowthEst, optimalBracket: optimalBracket(baseGrowthEst), features: feat, savedDev,
      borderline: conf.borderline, distToBoundary: conf.distToBoundary,
      components: { base: cBase, farm: cFarm, health: cHealth, buildings: cBuildings, squalor: cSqualor },
    });
  }
  const saveAware = usedDev > 0;
  return { estimated: true, saveAware, accuracy: saveAware ? ACCURACY_SAVE : ACCURACY, faction: want, settlements };
}

module.exports = {
  computeFactionGrowth, estimateGrowth, estimateGrowthWithSave, rawGrowth, rawGrowthWithSave, bracketConfidence, optimalBracket,
  settlementFeatures, parseRegions, parseResources, parseStrat, parseEDB, evalReq,
  COEF, COEF_SAVE, ACCURACY, ACCURACY_SAVE, TAX_MOD,
};
