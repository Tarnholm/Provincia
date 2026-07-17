// src/econBaseline.js — economy regression baseline (2026-07-17).
//
// The RIS balance team edits EDB/EDU/descr_strat daily. This module snapshots
// every campaign faction's TURN-1 economy to a named baseline JSON, then diffs
// the current mod files against that baseline and surfaces factions whose
// economy moved beyond a threshold — catching accidental balance breakage.
//
// METRIC (documented so the numbers are reproducible):
//   Per faction, incomeModel.computeTurn1Budget(modDataDir, faction, null,
//   { _noTribute: true }) — i.e. the validated static turn-1 model at
//   PLAYER perspective, ALL-NORMAL tax brackets, NO calibration save, and NO
//   protectorate-tribute modeling (_noTribute skips the client-net recursion;
//   tribute estimates are conservative floors anyway and would only add noise
//   to a regression diff). From its totals we keep:
//     settlements = nSettlements        (descr_strat settlement count)
//     income      = totals.income       (taxes+farming+mining+trade+admin, floored per line)
//     upkeep      = totals.armyUpkeep   (starting-army upkeep, EDU law)
//     net         = totals.net          (income − wages − corruption − armyUpkeep)
//   Determinism: the model reads mod files only (no save, no RNG) — same files
//   → same numbers. Precision is the income model's own (see its accuracy
//   notes); for regression purposes only the DELTA matters.
//
// Faction list = growthEval.parseStrat(descr_strat) keys (the campaign's real
// roster, incl. rebel/senate pseudo-factions — kept, so roster edits show up
// as added/removed rows).
//
// CJS, requireable from the main process (like incomeModel.js).

const path = require("path");

const SNAPSHOT_FIELDS = ["settlements", "income", "upkeep", "net"];

// Which direction is "better" per field, for UI coloring:
//   +1 = increase is better (income, net), -1 = increase is worse (upkeep),
//    0 = neutral (settlements — a roster/ownership change, not good or bad).
const FIELD_DIRECTION = { settlements: 0, income: 1, upkeep: -1, net: 1 };

const _num = (v) => (typeof v === "number" && Number.isFinite(v)) ? v : 0;

// Pure seam (unit-tested): budget result → snapshot row.
function snapshotRowFromBudget(b) {
  const t = (b && b.totals) || {};
  const upkeep = _num(t.armyUpkeep);
  // totals.net is null when armyUpkeepEDU failed; reconstruct from armyBudget.
  const net = (typeof t.net === "number" && Number.isFinite(t.net))
    ? t.net
    : _num(t.armyBudget) - upkeep;
  return {
    settlements: _num(b && b.nSettlements),
    income: _num(t.income),
    upkeep,
    net,
  };
}

// Build a full snapshot for a mod. `at` is left null — the caller (handler)
// stamps it, so the pure build stays timestamp-free and deterministic.
// opts.onProgress(done, total, faction) — optional, for long-run feedback.
function buildEconSnapshot(modDataDir, opts) {
  const gv = require("./growthEval.js");
  const im = require("./incomeModel.js");
  const stratPath = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  const strat = gv.parseStrat(stratPath);
  const facs = Object.keys(strat || {});
  if (!facs.length) return { error: "no factions parsed from " + stratPath };
  const factions = {};
  const errors = {};
  let done = 0;
  for (const fac of facs) {
    try {
      const b = im.computeTurn1Budget(modDataDir, fac, null, { _noTribute: true });
      if (b && b.error) errors[fac] = String(b.error);
      else factions[fac] = snapshotRowFromBudget(b);
    } catch (e) {
      errors[fac] = (e && e.message) || String(e);
    }
    done++;
    if (opts && typeof opts.onProgress === "function") {
      try { opts.onProgress(done, facs.length, fac); } catch { }
    }
  }
  const out = {
    at: null,                 // stamped by the capture handler
    modDataDir: String(modDataDir),
    metric: "turn1budget/player/normal-brackets/no-tribute/v1",
    factions,
  };
  if (Object.keys(errors).length) out.errors = errors;
  return out;
}

// Percent delta with a zero-base guard: divide by max(|base|, 1) so a 0→N
// move yields a finite, JSON-safe percentage (N × 100%) instead of Infinity.
function pctDelta(base, cur) {
  return ((cur - base) / Math.max(Math.abs(base), 1)) * 100;
}

// Diff two snapshots. Returns:
//   rows:    [{ faction, field, base, cur, deltaPct }] where |deltaPct| ≥
//            thresholdPct, sorted by |deltaPct| descending (ties: faction,
//            then field, for stable output).
//   added:   factions present in `current` but not in `baseline`
//   removed: factions present in `baseline` but not in `current`
// deltaPct sign convention: positive = the value WENT UP vs baseline
// (whether that is good or bad depends on the field — see FIELD_DIRECTION).
function diffEconSnapshots(current, baseline, thresholdPct) {
  const th = (typeof thresholdPct === "number" && Number.isFinite(thresholdPct) && thresholdPct >= 0)
    ? thresholdPct : 10;
  const curF = (current && current.factions) || {};
  const baseF = (baseline && baseline.factions) || {};
  const rows = [];
  const added = [], removed = [];
  for (const fac of Object.keys(curF)) if (!(fac in baseF)) added.push(fac);
  for (const fac of Object.keys(baseF)) if (!(fac in curF)) removed.push(fac);
  for (const fac of Object.keys(baseF)) {
    if (!(fac in curF)) continue;
    for (const field of SNAPSHOT_FIELDS) {
      const base = _num(baseF[fac][field]);
      const cur = _num(curF[fac][field]);
      if (base === cur) continue;
      const deltaPct = pctDelta(base, cur);
      if (Math.abs(deltaPct) >= th) {
        rows.push({ faction: fac, field, base, cur, deltaPct: Math.round(deltaPct * 10) / 10 });
      }
    }
  }
  rows.sort((a, b) =>
    Math.abs(b.deltaPct) - Math.abs(a.deltaPct)
    || a.faction.localeCompare(b.faction)
    || a.field.localeCompare(b.field));
  added.sort(); removed.sort();
  return { rows, added, removed };
}

module.exports = {
  buildEconSnapshot,
  diffEconSnapshots,
  snapshotRowFromBudget,
  pctDelta,
  SNAPSHOT_FIELDS,
  FIELD_DIRECTION,
};
