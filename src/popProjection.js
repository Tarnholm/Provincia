// Population projection (2026-07-17) — project every settlement of a faction N
// seasons (turns) forward at CURRENT conditions using the app's cracked growth
// model, and flag risks (decline / stall / tier-up / unrest) for balance work.
//
// MODEL SOURCES (nothing invented here — see the source modules for the cracked
// mechanics and their validation):
//   • growthEval.computeFactionGrowth — per-settlement baseGrowthEst (%/turn at
//     NORMAL tax, snapped to the game's 0.5% steps) + the feature vector
//     {farmLevel, healthSum, pgOther, govLevel, pop, level, squalorBase} that
//     feeds gv.rawGrowth. The ONLY pop-dependent term in rawGrowth is squalor
//     (floor(effectivePop/1500), doubling above 2× the tier base), so the
//     projection re-evaluates rawGrowth each turn with the projected pop and
//     tier — that is the model's own mechanic, not a new one.
//   • poModel.computeStartingPO — starting public-order % per settlement
//     (exact component model). Reported at NORMAL tax as a STATIC figure
//     (the PO model is a turn-1 model; we do not project it).
//   • descr_cultures.txt "settlement upgrade levels" — per-tier "upgrade"
//     population thresholds (RIS: village→town 1500, →large_town 4000, →city
//     9000, →large_city 17000, →huge_city 27000) and per-tier "base" values
//     (squalor doubling bases, shifted one tier down exactly like
//     growthEval.squalorBases does).
//
// CAVEATS (documented, deliberate):
//   • Tax is assumed NORMAL every turn (baseGrowthEst's reference bracket).
//   • Buildings-in-progress, plagues, scripted events, governor changes and
//     conquests are NOT modeled — this is "current conditions, compounded".
//   • Governor Effect-Squalor / clamping adjustments that computeFactionGrowth
//     applies on top of rawGrowth are carried forward as a CONSTANT offset
//     (exact at turn 0, static thereafter) — see `adj` below.
//   • Deterministic: same mod files in → same projection out. No RNG, no save.

"use strict";

const fs = require("fs");
const path = require("path");

const TIER_ORDER = ["village", "town", "large_town", "city", "large_city", "huge_city"];

// Fallback = the verified RIS values (descr_cultures roman block, read 2026-07-17).
const TIER_FALLBACK = {
  upgradeAt: { village: 0, town: 1500, large_town: 4000, city: 9000, large_city: 17000, huge_city: 27000 },
  squalorBase: { village: 400, town: 400, large_town: 2000, city: 4000, large_city: 9000, huge_city: 14000 },
};

// ---- pure helpers (exported for hermetic tests) ----

// Parse the FIRST "settlement upgrade levels" table from descr_cultures text.
// All RIS cultures share one table (same convention as growthEval.squalorBases,
// which also slices the first 6 "base" values). Returns { upgradeAt, squalorBase }
// or null if the file doesn't yield 6 of each.
//   upgradeAt[level]  = population needed to upgrade TO that level
//   squalorBase[level] = squalor doubling base for a settlement AT that level
//                        (previous tier's "base" — growthEval's one-tier shift)
function parseTierTable(text) {
  if (!text) return null;
  const upgrades = [...String(text).matchAll(/"upgrade"\s*:\s*(\d+)/g)].map((m) => +m[1]).slice(0, 6);
  const bases = [...String(text).matchAll(/"base"\s*:\s*(\d+)/g)].map((m) => +m[1]).slice(0, 6);
  if (upgrades.length < 6 || bases.length < 6) return null;
  const upgradeAt = {};
  TIER_ORDER.forEach((lv, i) => { upgradeAt[lv] = upgrades[i]; });
  return {
    upgradeAt,
    squalorBase: {
      village: bases[0], town: bases[0], large_town: bases[1],
      city: bases[2], large_city: bases[3], huge_city: bases[4],
    },
  };
}

const _tierCache = {};
function readTierTable(modDataDir) {
  if (!modDataDir) return TIER_FALLBACK;
  if (_tierCache[modDataDir]) return _tierCache[modDataDir];
  let out = TIER_FALLBACK;
  try {
    const t = parseTierTable(fs.readFileSync(path.join(modDataDir, "descr_cultures.txt"), "latin1"));
    if (t) out = t;
  } catch { /* fallback */ }
  return (_tierCache[modDataDir] = out);
}

// Population threshold to reach the NEXT tier from `level` (null at huge_city
// or unknown level).
function nextTierAt(level, tiers) {
  const idx = TIER_ORDER.indexOf(level);
  if (idx < 0) return null;
  const next = TIER_ORDER[idx + 1];
  if (!next) return null;
  const v = (tiers || TIER_FALLBACK).upgradeAt[next];
  return typeof v === "number" ? v : null;
}

// Simple static compound projection (used only as documentation of the naive
// path and by tests; the real projection re-evaluates growth per turn).
function compoundTrajectory(pop0, growthPct, turns) {
  const out = [];
  let pop = pop0 || 0;
  for (let t = 0; t < turns; t++) {
    pop = Math.max(0, Math.round(pop * (1 + (growthPct || 0) / 100)));
    out.push(pop);
  }
  return out;
}

// Dynamic projection: growthFn(pop, level) → %/turn (already snapped). The
// settlement tiers up (at most one level per turn, like the engine) when the
// post-growth pop crosses the next tier's upgrade threshold, which changes the
// squalor base growthFn sees from the next turn on.
function simulateTrajectory(pop0, level0, turns, growthFn, tiers) {
  const trajectory = [];
  let pop = pop0 || 0;
  let level = TIER_ORDER.includes(level0) ? level0 : "town";
  for (let t = 0; t < turns; t++) {
    const g = growthFn(pop, level);
    pop = Math.max(0, Math.round(pop * (1 + g / 100)));
    const next = TIER_ORDER[TIER_ORDER.indexOf(level) + 1];
    if (next && tiers && typeof tiers.upgradeAt[next] === "number" && pop >= tiers.upgradeAt[next]) level = next;
    trajectory.push(pop);
  }
  return { trajectory, finalLevel: level };
}

// First 1-based turn at which the trajectory reaches `threshold` (null if never
// or no threshold).
function firstReachTurn(trajectory, threshold) {
  if (threshold == null || !Array.isArray(trajectory)) return null;
  for (let i = 0; i < trajectory.length; i++) if (trajectory[i] >= threshold) return i + 1;
  return null;
}

// Risk flags. `declining` = the settlement loses population (negative growth
// now, or the projected end pop is below today's). `stalled` = effectively
// flat (|growth| < 0.1%/turn — with the game's 0.5% snapping that means 0)
// and not declining.
function riskFlags(growthPctPerTurn, popNow, trajectory) {
  const g = growthPctPerTurn || 0;
  const last = (Array.isArray(trajectory) && trajectory.length) ? trajectory[trajectory.length - 1] : popNow;
  const declining = g < -1e-9 || last < (popNow || 0);
  const stalled = !declining && Math.abs(g) < 0.1;
  return { declining, stalled };
}

const snap = (x) => Math.round(x * 2) / 2; // RTW growth steps are 0.5%

// ---- main entry ----
// projectPopulation(modDataDir, faction, turns=20) →
// { faction, turns, settlements: [{ settlement, region, popNow, growthPctPerTurn,
//   trajectory, tierNow, nextTierAt, reachesNextTierAtTurn, declining, stalled,
//   po, unrestRisk }], ... } or { error }.
function projectPopulation(modDataDir, faction, turns = 20) {
  const t0 = Date.now();
  const N = Math.max(1, Math.min(400, Math.floor(+turns) || 20));
  const gv = require("./growthEval.js");
  const r = gv.computeFactionGrowth(modDataDir, faction);
  if (!r || r.error) return { error: (r && r.error) || "growth model returned no result" };
  if (!Array.isArray(r.settlements) || !r.settlements.length) return { error: `no settlements found for ${faction}` };
  const tiers = readTierTable(modDataDir);

  // Public order (starting PO at NORMAL tax) — optional; the projection still
  // works without it (po: null) if the PO model can't load its inputs.
  let poByCity = null;
  try {
    const pm = require("./poModel.js");
    const po = pm.computeStartingPO(modDataDir, faction);
    if (po && Object.keys(po).length) poByCity = po;
  } catch { /* po stays null */ }

  const settlements = r.settlements.map((s) => {
    const feat = s.features || {};
    const tierNow = TIER_ORDER.includes(feat.level) ? feat.level : "town";
    // Per-turn growth from the model's own rawGrowth, with pop and tier updated
    // as the projection advances. `adj` carries the (constant) governor-squalor
    // delta computeFactionGrowth applied on top of bare rawGrowth, so turn 0
    // reproduces baseGrowthEst exactly.
    const bare0 = snap(gv.rawGrowth({ ...feat, pop: s.pop, level: tierNow }));
    const adj = (typeof s.baseGrowthEst === "number" ? s.baseGrowthEst : bare0) - bare0;
    const growthFn = (pop, level) => {
      const sb = tiers.squalorBase[level] != null ? tiers.squalorBase[level] : feat.squalorBase;
      return snap(gv.rawGrowth({ ...feat, pop, level, squalorBase: sb })) + adj;
    };
    const { trajectory, finalLevel } = simulateTrajectory(s.pop, tierNow, N, growthFn, tiers);
    const growthPctPerTurn = typeof s.baseGrowthEst === "number" ? s.baseGrowthEst : bare0;
    const nta = nextTierAt(tierNow, tiers);
    const flags = riskFlags(growthPctPerTurn, s.pop, trajectory);
    const poEntry = poByCity && (poByCity[s.settlement] || poByCity[String(s.settlement || "").replace(/_/g, " ")]);
    const po = poEntry && poEntry.poAt && typeof poEntry.poAt.normal === "number" ? poEntry.poAt.normal : null;
    return {
      settlement: s.settlement,
      region: s.region,
      popNow: s.pop,
      growthPctPerTurn,
      trajectory,
      tierNow,
      tierEnd: finalLevel,
      nextTierAt: nta,
      reachesNextTierAtTurn: firstReachTurn(trajectory, nta),
      declining: flags.declining,
      stalled: flags.stalled,
      po,
      // Unrest early-warning: starting PO (normal tax) already under 80% —
      // the riot line is 70%, so <80 leaves no headroom for the squalor that
      // comes with the projected growth. null when PO unavailable.
      unrestRisk: po != null ? po < 80 : null,
      borderline: !!s.borderline,
    };
  });

  return {
    faction: r.faction,
    turns: N,
    saveAware: !!r.saveAware,
    accuracy: r.accuracy || null,
    poAvailable: !!poByCity,
    taxAssumption: "normal",
    caveat: "Projection at current conditions: normal tax, no buildings-in-progress, no events, no governor changes. Growth re-evaluated per turn (pop-dependent squalor + tier upgrades); accuracy inherits the no-save growth model's estimate quality.",
    computeMs: Date.now() - t0,
    settlements,
  };
}

module.exports = {
  projectPopulation,
  // pure helpers (hermetic tests)
  parseTierTable, nextTierAt, compoundTrajectory, simulateTrajectory,
  firstReachTurn, riskFlags,
  TIER_ORDER, TIER_FALLBACK,
};
