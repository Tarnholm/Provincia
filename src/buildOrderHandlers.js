// src/buildOrderHandlers.js (2026-07-17)
//
// IPC for the build-order optimizer. registerBuildOrderHandlers(ipcMain) wires the
// single channel "rank-build-order" (modDataDir, faction, region) → rankBuildOrder()
// result or { error }. Follows the src/saveAnalysisHandlers.js pattern (CJS module,
// lazy require of the heavy model inside the handler).
//
// CACHE: rankBuildOrder is heavy — computeIncomeFeatures + computeTurn1Budget + a full
// EDB parse each run (~1-3s per faction on RIS; the trade model dominates). Result is
// cached per (modDataDir, faction) and the WHOLE faction result is sliced per region
// request, so re-selecting settlements in one faction is instant. The cache is
// invalidated on descr_strat OR export_descr_buildings mtime change (the two files that
// determine every number), so a mod edit re-computes on the next request.

"use strict";

const fs = require("fs");
const path = require("path");

function _mtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

function _stamp(modDataDir) {
  const strat = path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  const edb = path.join(modDataDir, "export_descr_buildings.txt");
  return `${_mtime(strat)}:${_mtime(edb)}`;
}

function registerBuildOrderHandlers(ipcMain) {
  // key: `${modDataDir}|${faction}` → { stamp, result } (full-faction result, region-sliced on read)
  const _cache = new Map();

  ipcMain.handle("rank-build-order", async (_event, modDataDir, faction, region) => {
    try {
      if (!modDataDir || !faction) return { error: "modDataDir + faction required" };
      const key = `${modDataDir}|${String(faction).toLowerCase()}`;
      const stamp = _stamp(modDataDir);
      let hit = _cache.get(key);
      if (!hit || hit.stamp !== stamp) {
        const { rankBuildOrder } = require("./buildOrder.js");
        const full = rankBuildOrder(modDataDir, faction, null); // whole faction; slice per region below
        if (full && full.error) return full;
        hit = { stamp, result: full };
        _cache.set(key, hit);
      }
      const full = hit.result;
      if (!region) return full;
      // slice the requested region out of the cached full-faction result
      const one = full.settlements.filter(s => s.region === region || s.settlement === region);
      return { faction: full.faction, tier: full.tier, nSettlements: one.length, settlements: one };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  });
}

module.exports = { registerBuildOrderHandlers };
