// src/garrisonBaseline.js
//
// Garrison BASELINE for save-anchored public order (2026-07-30, user decision:
// "the save is the starting point, and all edits past that should be added on
// top"). The calibration save's stored PO bakes in the garrison AS OF campaign
// start; the Army Setup applies edit descr_strat afterwards, so the anchored PO
// must carry the garrison DELTA (current descr_strat vs campaign start) on top
// of the anchor.
//
// The campaign-start garrison CANNOT be recovered from the save itself: save
// unit records carry officer-inclusive live soldier counts (the garrison law
// counts EDU base men ×4, no officers) and raw commanderUuid attribution needs
// the renderer's inference pass — verified unsound 2026-07-30 (Rome read 3460
// save-side vs the law's 24; 1301/1311 settlements mismatched). So instead the
// FIRST analysis with a given save SNAPSHOTS the descr_strat garrison table as
// that save's baseline — in the Army Setup flow analysis always precedes the
// applies, so the first-analysis state is the campaign-start state. (Cold-start
// caveat: a save first analyzed AFTER descr_strat edits bakes those edits into
// its baseline — only later edits show as deltas.)
//
// Baselines are small JSON files in `baselineDir` (main passes <userData>/
// garrison-baselines), keyed by a hash of the save path so nothing is ever
// written next to the game's own save files.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

function baselinePath(baselineDir, savePath) {
  const dir = baselineDir || path.join(os.tmpdir(), "provincia-garrison-baselines");
  const stem = path.basename(savePath).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
  const key = crypto.createHash("sha1").update(String(savePath)).digest("hex").slice(0, 12);
  return path.join(dir, `${stem}.${key}.json`);
}

// Load the baseline garrison table for `savePath`, creating it from the CURRENT
// descr_strat on first use. Returns { menByCity, created } or null when neither
// load nor create worked (callers then skip the delta — anchored PO behaves as
// before).
function loadOrCreateBaseline(savePath, modDataDir, baselineDir, log) {
  if (!savePath || !modDataDir) return null;
  const p = baselinePath(baselineDir, savePath);
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (j && j.menByCity) return { menByCity: j.menByCity, created: false };
  } catch { /* not created yet */ }
  try {
    const menByCity = require("./poModel.js").garrisonMenByCity(modDataDir);
    if (!Object.keys(menByCity).length) return null;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ createdAt: new Date().toISOString(), savePath, modDataDir, menByCity }));
    if (log) log(`garrison baseline created for ${path.basename(savePath)} (${Object.keys(menByCity).length} settlements)`);
    return { menByCity, created: true };
  } catch (e) {
    if (log) log(`garrison baseline failed (non-fatal): ${e && e.message}`);
    return null;
  }
}

// PO delta (in %) for a garrison change under the exact garrison law:
// pts = min(16, floor(70·men/pop)), row = 5·pts. Returns 0 when nothing changed
// or inputs are unusable — callers can add it unconditionally.
function garrisonAdjust(menNow, menBase, pop) {
  if (!(pop > 0) || menNow == null || menBase == null || menNow === menBase) return 0;
  const { GARRISON_K, GARRISON_CAP_PTS } = require("./poModel.js");
  const pts = (m) => Math.min(GARRISON_CAP_PTS, Math.floor(GARRISON_K * m / pop));
  return 5 * (pts(menNow) - pts(menBase));
}

module.exports = { loadOrCreateBaseline, baselinePath, garrisonAdjust };
