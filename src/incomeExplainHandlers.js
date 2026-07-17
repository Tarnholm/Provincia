// Income explainer IPC (2026-07-17). One handler: "explain-settlement-income"
// (modDataDir, faction, region) → a line-itemed breakdown of where a
// settlement's turn-1 income comes from, assembled from the cracked income
// model (src/incomeModel.js):
//   tax     — the EDB taxable-% INPUT lines per building (chain/val/req). We
//             deliberately do NOT re-derive the engine tax denarii here (the
//             real formula is capital-vs-non-capital + pop-base + bracket, see
//             computeTurn1Budget) — the panel shows honest "taxable points".
//   farming — CALIB.farmPoint × (farmN + farmLevel) ≈ 73.6/pt (farming EXACT
//             11/11 on the corpus). Base value: governor growthFarm and the
//             Hanging Gardens ×1.2 are campaign-state and excluded.
//   mining  — CALIB.minePoint × mine_resource × Σ(qty × trade value), taken
//             from mineProspects() currentIncome (validated to the denarius).
//   trade   — the EDB trade-% input lines (kind:"trade" entries of the same
//             explain array) + the settlement's total tradePct.
//
// CACHE: computeIncomeFeatures re-parses descr_strat + EDB (+ regions) per
// call — seconds on big mods. Results are memoized per (modDataDir, faction)
// and invalidated when descr_strat/export_descr_buildings mtimes change.
// mineProspects keeps its own per-modDataDir cache inside incomeModel.js.
"use strict";
const fs = require("fs");
const path = require("path");

// ---- pure assembly: features row + mine prospects → explainer payload ----
// Exported for tests. `features` is the computeIncomeFeatures(modDataDir,
// faction, { explain: true }) result; `prospects` is mineProspects(modDataDir).
function assembleExplainPayload(features, prospects, region, faction) {
  if (!features || features.error) {
    return { error: (features && features.error) || "no income features", region, faction };
  }
  const rows = features.settlements || [];
  const want = String(region || "").toLowerCase();
  const row = rows.find((s) => s.region === region)
    || rows.find((s) => String(s.region || "").toLowerCase() === want)
    || rows.find((s) => String(s.settlement || "").toLowerCase() === want);
  if (!row) return { error: `no settlement for region "${region}" owned by ${features.faction || faction}`, region, faction };
  // taxableLines is a MIXED explain array: taxable entries {chain,val,req} and
  // trade entries {kind:"trade",chain,val,req} (incomeModel.js L173-174).
  const all = row.taxableLines || row.taxExplain || [];
  const taxLines = all.filter((l) => l && l.kind !== "trade").map(({ chain, val, req }) => ({ chain, val, req: req || "" }));
  const tradeLines = all.filter((l) => l && l.kind === "trade").map(({ chain, val, req }) => ({ chain, val, req: req || "" }));
  const { CALIB } = require("./incomeModel.js");
  const prospect = (prospects || {})[row.region] || null;
  const qtyVal = prospect ? prospect.qtyVal : 0;
  const mineIncome = prospect
    ? prospect.currentIncome // real number, already Math.round(minePoint × mineSum × qtyVal)
    : Math.round(CALIB.minePoint * (row.mineSum || 0) * qtyVal);
  return {
    settlement: row.settlement || row.region,
    region: row.region,
    faction: features.faction || String(faction || "").toLowerCase(),
    tax: { taxablePct: row.taxablePct || 0, lines: taxLines },
    farming: {
      farmN: row.farmN || 0,
      farmLevel: row.farmLevel || 0,
      // Base farming denarii/turn (no governor bonus, no Hanging Gardens).
      income: Math.round(CALIB.farmPoint * ((row.farmN || 0) + (row.farmLevel || 0))),
    },
    mining: { mineSum: row.mineSum || 0, qtyVal, income: mineIncome },
    trade: { tradePct: row.tradePct || 0, lines: tradeLines },
    resources: row.resources || [],
  };
}

// ---- (modDataDir, faction) → features cache, keyed on source-file mtimes ----
const _featuresCache = new Map();
function _sourceStamp(modDataDir) {
  const stamp = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  return stamp(path.join(modDataDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"))
    + "|" + stamp(path.join(modDataDir, "export_descr_buildings.txt"));
}
function _featuresFor(modDataDir, faction) {
  const im = require("./incomeModel.js");
  const key = modDataDir + "|" + String(faction).toLowerCase();
  const mt = _sourceStamp(modDataDir);
  const hit = _featuresCache.get(key);
  if (hit && hit.mt === mt) return hit.features;
  const features = im.computeIncomeFeatures(modDataDir, faction, { explain: true });
  _featuresCache.set(key, { mt, features });
  return features;
}

function registerIncomeExplainHandlers(ipcMain) {
  ipcMain.handle("explain-settlement-income", async (_event, modDataDir, faction, region) => {
    try {
      if (!modDataDir || !faction || !region) return { error: "modDataDir + faction + region required" };
      const im = require("./incomeModel.js");
      const features = _featuresFor(modDataDir, faction);
      const prospects = im.mineProspects(modDataDir); // per-dir cache inside incomeModel
      return assembleExplainPayload(features, prospects, region, faction);
    } catch (e) {
      return { error: e && e.message ? e.message : "explain-settlement-income failed" };
    }
  });
}

module.exports = { registerIncomeExplainHandlers, assembleExplainPayload };
