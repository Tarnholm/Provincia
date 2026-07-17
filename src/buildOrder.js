// src/buildOrder.js (2026-07-17)
//
// BUILD-ORDER OPTIMIZER. For a selected settlement (or a whole faction), rank every
// buildable-next structure by MODELED PAYBACK — cost / extra-income-per-turn — so a
// player or balancer sees the best next build at a glance.
//
// MODEL (discovery notes in the session report). Income is valued by computing a
// settlement's income WITH vs WITHOUT a building level in its build state, mirroring
// how src/incomeModel.js:computeIncomeFeatures walks `s.buildings` and the per-level
// cap contributions in parseEDBIncome's capIndex (taxable / trade / mine lines per
// `chain:level`). A building level's marginal contribution to the four income channels
// is evaluated against the settlement's context (region tags, faction, empire tier),
// then converted to denarii/turn using the SAME calibrated constants incomeModel's
// computeTurn1Budget uses:
//
//   Δtaxes  = tax(taxablePct + Δ) − tax(taxablePct)   [multi-town flat/capital law,
//             evaluated at Normal rate; single-town city-states: building points ≈ 0,
//             matching the model's collapsed city-state tax — see CALIB.taxLogK_single]
//   Δfarm   = CALIB.farmPoint × ΔfarmLevel            [farm level = max over chains]
//   Δmine   = CALIB.minePoint × ΔmineSum × qtyVal     [qtyVal from mine deposits]
//   Δtrade  = baseTrade × (M_new / M_old − 1)         [M = 1 + tradePct/10, the cracked
//             market/colony trade-building multiplier — Corduba/Leukas experiments]
//
// baseTrade is the settlement's current modeled trade (computeTurn1Budget). Trade thus
// values a market/forum/port UPGRADE by how much it scales the town's existing trade;
// a town with no active trade routes gets a 0 trade-delta (honest — nothing to amplify).
//
// Non-income buildings (walls, happiness/health, recruitment-only) get category +
// note and a null payback, sorted after the income buildings.
//
// Construction cost/time come from the EDB `cost` / `construction` lines inside each
// building level block (parseConstructionCosts). Buildable-next = the +1 level in each
// chain reachable from the settlement's current chain state, gated with growthEval's
// evalReq (factions / hidden_resource / resource / building_present_min_level / size /
// major_event / is_player) plus a settlement_min tier check. Divergences from
// regionInfoDerive.deriveRecruitable: this reuses evalReq wholesale for the level's
// `requires` (deriveRecruitable hand-rolls the same gates for recruit lines and also
// resolves mic_/gov_/colony_/culture_ tier aliases — those almost never gate BUILDING
// levels, so they are not resolved here; a level requiring one is treated as blocked).
//
// Deterministic: chains iterated in sorted order, options sorted by payback then name.

"use strict";

const fs = require("fs");
const path = require("path");
const gv = require("./growthEval.js");
const im = require("./incomeModel.js");

const CALIB = im.CALIB;
const BRACKET_MULT = { low: 0.8, normal: 1.0, high: 1.2, very_high: 1.5 };
const SETTLEMENT_ORDER = ["village", "town", "large_town", "city", "large_city", "huge_city"];

function stratPathOf(modDataDir) {
  return path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
}

// ---- popBase(pop): the measured populace tax-base curve (mirror of computeTurn1Budget) ----
function popBaseOf(pop, capital, ris) {
  const pp = Math.max(400, pop);
  const table = (pp >= CALIB.taxCliffPop && !(ris && capital)) ? CALIB.popBasePost : CALIB.popBasePre;
  if (pp <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (pp <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (pp - x0) / (x1 - x0);
    }
  }
  const [x0, y0] = table[table.length - 2], [x1, y1] = table[table.length - 1];
  return y1 + (y1 - y0) * (pp - x1) / (x1 - x0);
}

// Integer settlement tax at Normal rate for a given taxablePct (no governor, no H).
// Mirrors computeTurn1Budget's tTaxNoH at mult=1: trunc(popBase + M·taxablePct) for
// multi-town; single-town city-states carry ~no building-point tax (points collapse).
function settlementTaxAt(taxablePct, { pop, capital, tier, multiTown, ris }) {
  if (!multiTown) return null; // single-town: building points don't move city-state tax
  const pb = popBaseOf(pop, capital, ris);
  const capTax = !!capital;
  const M = capTax ? (taxablePct >= 0 ? 40 : 4) : (tier <= 2 ? 40 : 4);
  return Math.trunc(pb + M * taxablePct); // Normal rate → mult = 1 (capital/non-capital coincide)
}

// ---- EDB construction-cost / gate parser: chain → { levels, byLevel:{ level → meta } } ----
// meta = { cost, turns, settlementMin, requires, category flags, order idx }.
// Single pass; keyword flags classify NON-income buildings for the payback table.
function parseConstructionCosts(edbPath) {
  const lines = fs.readFileSync(edbPath, "latin1").split(/\r?\n/);
  const out = {};
  let curBuilding = null, levelsList = [], curLevel = null, curIcon = null, curMeta = null;
  let upgradesPending = false, inUpgrades = false;
  for (const raw of lines) {
    const ln = raw.replace(/;.*$/, "");
    const bm = ln.match(/^building\s+(\w+)/);
    if (bm) {
      curBuilding = bm[1]; levelsList = []; curLevel = null; curIcon = null; curMeta = null;
      upgradesPending = false; inUpgrades = false;
      out[curBuilding] = { icon: null, levels: [], byLevel: {} };
      continue;
    }
    if (!curBuilding) continue;
    // Skip the `upgrades { <levelname> }` sub-block — its tokens ARE level names and would
    // otherwise be misread as phantom level declarations.
    const trimmed = ln.trim();
    if (inUpgrades) { if (trimmed === "}") inUpgrades = false; continue; }
    if (trimmed === "upgrades") { upgradesPending = true; continue; }
    if (upgradesPending) { if (trimmed === "{") { inUpgrades = true; upgradesPending = false; } continue; }
    const icm = ln.match(/^\s*icon\s+(\S+)/);
    if (icm && !curIcon) { curIcon = icm[1]; out[curBuilding].icon = curIcon; continue; }
    const lm = ln.match(/^\s*levels\s+(.+)$/);
    if (lm) { levelsList = lm[1].trim().split(/\s+/).filter(w => w && w !== "{"); out[curBuilding].levels = levelsList.slice(); continue; }
    // level declaration: first token is a known level name, next is requires/{/EOL
    const tok = ln.trim().split(/\s+/);
    if (levelsList.length && tok[0] && levelsList.includes(tok[0]) && (tok[1] === "requires" || tok[1] === undefined || tok[1] === "{")) {
      curLevel = tok[0];
      const reqM = ln.trim().replace(/\{$/, "").trim().match(/^\S+\s+requires\s+(.+)$/);
      curMeta = {
        cost: null, turns: null, settlementMin: null,
        requires: reqM ? reqM[1].trim() : "",
        icon: curIcon, order: levelsList.indexOf(curLevel),
        hasWalls: false, hasHealth: false, hasHappiness: false, hasLaw: false, hasRecruit: false,
      };
      out[curBuilding].byLevel[curLevel] = curMeta;
      continue;
    }
    if (!curMeta) continue;
    let m;
    if ((m = ln.match(/^\s*construction\s+(\d+)/))) { curMeta.turns = +m[1]; continue; }
    if ((m = ln.match(/^\s*cost\s+(\d+)/))) { curMeta.cost = +m[1]; continue; }
    if ((m = ln.match(/^\s*settlement_min\s+(\w+)/))) { curMeta.settlementMin = m[1]; continue; }
    const t = ln.trim();
    if (/^wall_level\b/.test(t)) curMeta.hasWalls = true;
    else if (/^tower_level\b|^gate_/.test(t)) curMeta.hasWalls = true;
    else if (/^population_health_bonus\b/.test(t)) curMeta.hasHealth = true;
    else if (/^happiness_bonus\b/.test(t)) curMeta.hasHappiness = true;
    else if (/^law_bonus\b/.test(t)) curMeta.hasLaw = true;
    else if (/^recruit(_pool|_priority_offset)?\b/.test(t) || /^recruits_morale_bonus\b/.test(t) || /^free_upkeep_bonus\b/.test(t)) curMeta.hasRecruit = true;
  }
  return out;
}

// Sum a level's cap contributions to one channel under a settlement ctx.
function sumCap(cap, kind, ctx) {
  if (!cap || !cap[kind]) return 0;
  let s = 0;
  for (const x of cap[kind]) if (gv.evalReq(x.req, ctx)) s += x.val;
  return s;
}

// Max farming level a growth-EDB chain:level would grant under ctx (growth semantics).
function farmValueOf(growthEDB, chain, level, ctx) {
  const cap = growthEDB.capIndex[chain + ":" + level];
  if (!cap || !cap.farming) return 0;
  let fl = null;
  for (const x of cap.farming) if (gv.evalReq(x.req, ctx)) fl = (fl == null) ? x.val : Math.max(fl, x.val);
  return fl == null ? 0 : fl;
}

// ---- PURE valuation: channel deltas → denarii/turn (hermetically testable) ----
// ctx0 carries the settlement's fixed state + baselines. deltas are the building's
// marginal channel contributions (WITH minus WITHOUT the level).
function valueBuildingDelta({ dTaxablePct = 0, dTradePct = 0, dMineSum = 0, dFarmLevel = 0 },
  { pop, capital, tier, multiTown, ris, taxablePctBase, tradePctBase, baseTrade, mineQtyVal }) {
  // taxes: recompute integer settlement tax at Normal with vs without the points
  let dTax = 0;
  if (dTaxablePct !== 0 && multiTown) {
    const a = settlementTaxAt(taxablePctBase, { pop, capital, tier, multiTown, ris });
    const b = settlementTaxAt(taxablePctBase + dTaxablePct, { pop, capital, tier, multiTown, ris });
    dTax = (b || 0) - (a || 0);
  }
  // farming: farmPoint per level
  const dFarm = CALIB.farmPoint * (dFarmLevel || 0);
  // mining: minePoint × mine points × per-region quantity value
  const dMine = CALIB.minePoint * (dMineSum || 0) * (mineQtyVal || 0);
  // trade: the trade-building multiplier scales the town's EXISTING trade
  let dTrade = 0;
  if (dTradePct !== 0 && baseTrade > 0) {
    const mOld = Math.max(0, 1 + (tradePctBase || 0) / 10);
    const mNew = Math.max(0, 1 + ((tradePctBase || 0) + dTradePct) / 10);
    if (mOld > 0) dTrade = baseTrade * (mNew / mOld - 1);
  }
  const total = dTax + dFarm + dMine + dTrade;
  return {
    incomeDeltaPerTurn: Math.round(total),
    breakdown: { tax: Math.round(dTax), farm: Math.round(dFarm), mine: Math.round(dMine), trade: Math.round(dTrade) },
  };
}

// Category + note for a building option given its channel deltas and EDB flags.
function classify(meta, breakdown, incomeDelta) {
  if (incomeDelta > 0) {
    const parts = [];
    if (breakdown.tax) parts.push(`+${breakdown.tax} tax`);
    if (breakdown.trade) parts.push(`+${breakdown.trade} trade`);
    if (breakdown.mine) parts.push(`+${breakdown.mine} mining`);
    if (breakdown.farm) parts.push(`+${breakdown.farm} farming`);
    return { category: "economy", note: parts.join(", ") || "income" };
  }
  // no modeled income — describe the real value
  if (meta.hasWalls) return { category: "military", note: "Defensive walls/towers — no income; raises siege hold-out and control." };
  if (meta.hasRecruit) return { category: "military", note: "Recruitment building — no direct income; unlocks/boosts units." };
  if (meta.hasHappiness || meta.hasHealth || meta.hasLaw) {
    const bits = [];
    if (meta.hasHappiness) bits.push("happiness");
    if (meta.hasHealth) bits.push("population health");
    if (meta.hasLaw) bits.push("law/order");
    return { category: "happiness", note: `Public order — ${bits.join(" / ")}; no direct income.` };
  }
  // an economy building whose modeled delta is <= 0 (e.g. trade multiplier with no routes)
  if (meta.category === "economy" || /trade|market|port|mine|farm/i.test(meta.icon || "")) {
    return { category: "economy", note: "No modeled income gain here (e.g. no active trade routes to amplify)." };
  }
  return { category: "other", note: "No modeled income effect." };
}

function humanize(name) {
  return String(name || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// payback = cost / income-delta, one decimal; null when the delta returns nothing.
function paybackOf(cost, incomeDeltaPerTurn) {
  return incomeDeltaPerTurn > 0 ? Math.round((cost / incomeDeltaPerTurn) * 10) / 10 : null;
}

// ---- main entry ----
function rankBuildOrder(modDataDir, faction, regionOrNull) {
  const stratPath = stratPathOf(modDataDir);
  const edbPath = path.join(modDataDir, "export_descr_buildings.txt");
  if (!fs.existsSync(stratPath) || !fs.existsSync(edbPath)) return { error: "descr_strat or EDB not found" };
  const want = String(faction || "").toLowerCase();

  const F = im.computeIncomeFeatures(modDataDir, want, { isPlayer: true });
  if (F.error) return F;
  // per-settlement modeled trade (baseline) for the trade multiplier
  let baseTradeBySettlement = {};
  try {
    const B = im.computeTurn1Budget(modDataDir, want, null, {});
    if (B && B.settlements) for (const s of B.settlements) baseTradeBySettlement[s.settlement] = s.trade || 0;
  } catch { /* trade multiplier degrades to 0 — non-fatal */ }

  const inc = im.parseEDBIncome(edbPath);
  const growthEDB = gv.parseEDB(edbPath);
  const costs = parseConstructionCosts(edbPath);
  const { byRegion } = gv.parseRegions(modDataDir);
  const resourcesByRegion = gv.parseResources(stratPath);
  const factionGroups = gv.parseFactionGroups(modDataDir);
  const factionTokens = gv.factionTokenSet(want, factionGroups);
  const tier = F.tier;
  const multiTown = F.settlements.length > 1;
  const ris = (function () { try { const fd = fs.openSync(path.join(modDataDir, "world", "maps", "base", "map.rwm"), "r"); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, 0); fs.closeSync(fd); return b[0] >= 0x7b; } catch { return true; } })();
  let prospects = {};
  try { prospects = im.mineProspects(modDataDir) || {}; } catch { /* mine valuation degrades */ }

  const outSettlements = [];
  for (const s of F.settlements) {
    if (regionOrNull && s.region !== regionOrNull && s.settlement !== regionOrNull) continue;
    const region = byRegion[s.region];
    if (!region) continue;

    // current chain → level index (the WITH-state build map)
    const buildings = new Map();
    for (const bstr of (s.buildings || [])) {
      const [chain, level] = String(bstr).split(":");
      const order = inc.chainLevels[chain] || [];
      const idx = order.indexOf(level);
      buildings.set(chain, idx < 0 ? 0 : idx);
    }
    const mkCtx = (bmap) => ({
      hidden: region.hidden || new Set(), buildings: bmap, chainLevels: inc.chainLevels, aliases: inc.aliases,
      capital: s.capital, faction: want, factionTokens,
      homeland: [...(region.hidden || [])].some(h => h.startsWith("homeland")),
      sizeTier: 1, resources: resourcesByRegion[s.region] || new Set(),
      isPlayer: true, empireTier: tier,
    });
    const sLevelIdx = SETTLEMENT_ORDER.indexOf(s.level);
    const baseTrade = baseTradeBySettlement[s.settlement] || 0;
    const mineQtyVal = (prospects[s.region] && prospects[s.region].qtyVal) || 0;

    const options = [];
    for (const chain of Object.keys(costs).sort()) {
      const chainDef = costs[chain];
      const order = chainDef.levels;
      if (!order || !order.length) continue;
      const curIdx = buildings.has(chain) ? buildings.get(chain) : -1;
      const toIdx = curIdx + 1;
      if (toIdx >= order.length) continue; // chain already maxed
      const toLevel = order[toIdx];
      const fromLevel = curIdx >= 0 ? order[curIdx] : null;
      const meta = chainDef.byLevel[toLevel];
      if (!meta || meta.cost == null) continue; // no build cost (structural/ghost level) → skip

      // WITH-state ctx: the new level is in place
      const bmapWith = new Map(buildings);
      bmapWith.set(chain, toIdx);
      const ctxWith = mkCtx(bmapWith);

      // gate: level `requires` + settlement_min tier
      if (meta.requires && !gv.evalReq(meta.requires, ctxWith)) continue;
      if (meta.settlementMin) {
        const minIdx = SETTLEMENT_ORDER.indexOf(meta.settlementMin);
        if (minIdx > sLevelIdx && sLevelIdx >= 0) continue;
      }

      // channel deltas: WITH (toLevel) minus WITHOUT (fromLevel), both under ctxWith
      const capTo = inc.capIndex[chain + ":" + toLevel];
      const capFrom = fromLevel ? inc.capIndex[chain + ":" + fromLevel] : null;
      const dTaxablePct = sumCap(capTo, "taxable", ctxWith) - sumCap(capFrom, "taxable", ctxWith);
      const dTradePct = sumCap(capTo, "trade", ctxWith) - sumCap(capFrom, "trade", ctxWith);
      const dMineSum = sumCap(capTo, "mine", ctxWith) - sumCap(capFrom, "mine", ctxWith);
      // farm: raise the max only if this chain's new level exceeds current farm max
      const fvTo = farmValueOf(growthEDB, chain, toLevel, ctxWith);
      const dFarmLevel = fvTo > (s.farmLevel || 0) ? fvTo - (s.farmLevel || 0) : 0;

      const { incomeDeltaPerTurn, breakdown } = valueBuildingDelta(
        { dTaxablePct, dTradePct, dMineSum, dFarmLevel },
        { pop: s.pop, capital: s.capital, tier, multiTown, ris,
          taxablePctBase: s.taxablePct || 0, tradePctBase: s.tradePct || 0, baseTrade, mineQtyVal });

      // classify — mark economy intent so a zero-delta trade building still reads economy
      meta.category = (dTaxablePct || dTradePct || dMineSum || dFarmLevel) ? "economy" : undefined;
      const { category, note } = classify(meta, breakdown, incomeDeltaPerTurn);
      const paybackTurns = paybackOf(meta.cost, incomeDeltaPerTurn);

      options.push({
        chain,
        fromLevel,
        toLevel,
        name: humanize(toLevel),
        cost: meta.cost,
        turns: meta.turns,
        incomeDeltaPerTurn,
        paybackTurns,
        category,
        note,
      });
    }

    // income options (finite payback) first, ascending payback; then non-income, by category+name
    options.sort((a, b) => {
      const ap = a.paybackTurns, bp = b.paybackTurns;
      if (ap != null && bp != null) return ap - bp || a.chain.localeCompare(b.chain);
      if (ap != null) return -1;
      if (bp != null) return 1;
      return a.category.localeCompare(b.category) || a.chain.localeCompare(b.chain);
    });

    outSettlements.push({ settlement: s.settlement, region: s.region, capital: !!s.capital, level: s.level, pop: s.pop, options });
  }

  return { faction: want, tier: F.tier, nSettlements: outSettlements.length, settlements: outSettlements };
}

module.exports = { rankBuildOrder, valueBuildingDelta, parseConstructionCosts, settlementTaxAt, popBaseOf, paybackOf, classify, humanize };
