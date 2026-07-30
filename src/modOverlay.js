// src/modOverlay.js
//
// SUBMOD OVERLAY RESOLUTION for the analysis pipeline (2026-07-30, the
// RIS_Four_Romans bug). A submod like C:\RIS\_submods\RIS_Four_Romans\data is a
// thin overlay: it ships ONLY the files it changes (descr_strat + campaign
// script + text) and the game's VFS layers it over the base mod. Provincia's
// analysis modules read ~60 files via plain path.join(modDataDir, ...), so
// pointing them at the submod found the campaign but NO EDU/EDB/descr_regions/
// map files — the Army Setup parsed the armies and then every budget/pool/PO
// computation came back empty ("descr_strat or EDB not found", 0 EDU units).
//
// effectiveModDataDir(modDataDir) mirrors the engine: it materialises a MERGED
// VIEW of submod-over-base in a cache dir and returns that path, so every
// existing read works unchanged through one choke point (the analysis IPC
// handlers). Mechanics:
//   - fast path: modDataDir already has export_descr_unit.txt → returned as-is
//     (a full mod; zero cost for the normal RIS case).
//   - base = nearest related dir carrying export_descr_unit.txt
//     (modPathResolver.findRelatedModDirs — walks up and scans siblings, which
//     finds C:\RIS\RIS\data from C:\RIS\_submods\<name>\data).
//   - merge: recursive union, SUBMOD WINS per file. Directories only one side
//     touches become JUNCTIONS (no copies — the big ui/world/maps/base trees
//     stay live, so external edits flow through instantly and the mod-file
//     epoch sees real mtimes). Files along genuinely-merged paths are COPIED
//     with mtime synced to the source, refreshed whenever src mtime/size move.
//   - WRITE handlers must keep using the ORIGINAL modDataDir: the Army Setup
//     applies write the submod's real descr_strat (which exists there — it is
//     the overlay's whole point); the merged copy refreshes on the next
//     analysis. Only READ/analysis handlers should route through this.
//   - any failure → returns the original dir and logs; behaviour degrades to
//     exactly what it was before this module existed.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { findRelatedModDirs } = require("./modPathResolver.js");

const _throttle = new Map(); // mergeKey → last refresh wall-clock ms

function _copyIfStale(src, dst) {
  const s = fs.statSync(src);
  let d = null;
  try { d = fs.statSync(dst); } catch { }
  if (d && d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 1000) return;
  try { fs.rmSync(dst, { force: true }); } catch { }
  fs.copyFileSync(src, dst);
  fs.utimesSync(dst, s.atime, s.mtime);
}

function _ensureJunction(dst, target) {
  try {
    const cur = fs.readlinkSync(dst);
    if (path.resolve(cur) === path.resolve(target)) return;
    fs.rmSync(dst, { recursive: true, force: true });
  } catch { /* not a link / missing */
    try { if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true }); } catch { }
  }
  fs.symlinkSync(target, dst, "junction");
}

// Recursive submod-wins merge of one directory level.
function _mergeDir(subDir, baseDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const list = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  const subNames = new Set(list(subDir));
  const baseNames = new Set(list(baseDir));
  const union = new Set([...subNames, ...baseNames]);
  for (const name of union) {
    const subP = path.join(subDir, name), baseP = path.join(baseDir, name), outP = path.join(outDir, name);
    const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };
    const sS = subNames.has(name) ? stat(subP) : null;
    const bS = baseNames.has(name) ? stat(baseP) : null;
    if (sS && bS && sS.isDirectory() && bS.isDirectory()) { _mergeDir(subP, baseP, outP); continue; }
    // one-sided (or type-mismatched — submod wins): junction dirs, copy files
    const winP = sS ? subP : baseP, winS = sS || bS;
    if (winS.isDirectory()) _ensureJunction(outP, winP);
    else _copyIfStale(winP, outP);
  }
  // prune entries whose source vanished
  for (const name of list(outDir)) {
    if (!union.has(name)) { try { fs.rmSync(path.join(outDir, name), { recursive: true, force: true }); } catch { } }
  }
}

// → the dir the ANALYSIS pipeline should read. See module header.
function effectiveModDataDir(modDataDir, cacheRoot, log) {
  if (!modDataDir) return modDataDir;
  try {
    if (fs.existsSync(path.join(modDataDir, "export_descr_unit.txt"))) return modDataDir; // full mod
    if (!fs.existsSync(path.join(modDataDir, "world"))) return modDataDir; // not a mod data dir at all
    const bases = findRelatedModDirs(modDataDir, "export_descr_unit.txt")
      .filter((d) => path.resolve(d) !== path.resolve(modDataDir));
    if (!bases.length) return modDataDir; // overlay with no findable base — unchanged behaviour
    const base = bases[0];
    const key = path.resolve(modDataDir) + "|" + path.resolve(base);
    const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
    const outDir = path.join(cacheRoot || path.join(os.tmpdir(), "provincia-mod-overlay"), hash);
    const now = Date.now();
    if (now - (_throttle.get(key) || 0) >= 1000) {
      _throttle.set(key, now);
      const fresh = !fs.existsSync(outDir);
      _mergeDir(modDataDir, base, outDir);
      if (fresh && log) log(`mod overlay: merged ${modDataDir} over ${base} → ${outDir}`);
    }
    return outDir;
  } catch (e) {
    if (log) log(`mod overlay failed (non-fatal, reading submod dir directly): ${e && e.message}`);
    return modDataDir;
  }
}

module.exports = { effectiveModDataDir };
