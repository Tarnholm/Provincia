// src/activeCampaign.js
//
// WHICH CAMPAIGN THE EDITS BELONG TO (2026-10-16, Hadrian's RIS Light save).
// The main process knows the active mod only as `activeModDataDir`, and for a
// submod that is the BASE mod: the renderer derives it from the icons folder,
// which a submod never ships. Every descr_strat edit then looked for
// imperial_campaign under the base mod, so his RIS Light farm edits were
// written into RIS's MAIN campaign by region name (Light "Latium" = Rome, main
// "Latium" = Praeneste) and ris_light/descr_strat.txt was never touched.
//
// The renderer now tells the main process the imported campaign folder
// (".../world/maps/campaign/ris_light"). From it:
//   stratPath()  the campaign's own descr_strat.txt
//   dataRoot()   the data folder that owns it (the submod's data dir)
//   resolve()    where a mod-relative write really goes: campaign files to the
//                campaign folder, anything the submod ships to the submod,
//                everything else to the base mod as before.
// Not set (or set to a folder without a descr_strat) = the old behaviour.

"use strict";

const fs = require("fs");
const path = require("path");

let _folder = null;

const CAMPAIGN_FILE_RE = /^world\/maps\/campaign\/[A-Za-z0-9_]+\/(descr_strat\.txt|descr_win_conditions\.txt)$/;

// A rejected folder CLEARS the setting: keeping the previous campaign would aim
// the next Save at whatever slot was loaded before.
function setFolder(folder) {
  _folder = null;
  if (folder == null || folder === "") return { ok: true, folder: null };
  if (typeof folder !== "string") return { ok: false, error: `expected a folder path string, got ${typeof folder}` };
  const abs = path.resolve(folder);
  const norm = abs.replace(/\\/g, "/");
  if (!/\/world\/maps\/campaign\/[^/]+$/i.test(norm)) return { ok: false, error: `not a campaign folder: ${abs}` };
  if (!fs.existsSync(path.join(abs, "descr_strat.txt"))) return { ok: false, error: `no descr_strat.txt in ${abs}` };
  _folder = abs;
  return { ok: true, folder: abs, stratPath: stratPath(), dataRoot: dataRoot() };
}

function folder() { return _folder; }

function stratPath() {
  if (!_folder) return null;
  const p = path.join(_folder, "descr_strat.txt");
  return fs.existsSync(p) ? p : null;
}

// <root>/world/maps/campaign/<name> → <root>
function dataRoot() {
  return _folder ? path.resolve(_folder, "..", "..", "..", "..") : null;
}

// Absolute target of a mod-relative path ("world/maps/base/descr_regions.txt").
function resolve(modDataDir, relPath) {
  const rel = String(relPath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (_folder) {
    const m = rel.match(CAMPAIGN_FILE_RE);
    if (m) return path.join(_folder, m[1]);
    const own = path.join(dataRoot(), rel);
    if (fs.existsSync(own)) return own;
  }
  return path.join(modDataDir, rel);
}

module.exports = { setFolder, folder, stratPath, dataRoot, resolve, CAMPAIGN_FILE_RE };
