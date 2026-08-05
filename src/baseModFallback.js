// src/baseModFallback.js
//
// BASE-MOD INHERITANCE FOR THE CAMPAIGN IMPORT SCAN (2026-08-06, the
// "map edits in the base folder never reach a submod slot" bug).
//
// A thin submod (e.g. C:\RIS\_submods\RIS_Four_Romans\data) ships ONLY the
// files it changes — descr_strat + campaign script + text. The folder scans
// (scan-folder / select-folder) only inherit missing campaign files from a
// `base` directory found INSIDE the selected tree, so a submod import found
// no map files at all: the slot kept whatever map copies it had from an
// earlier import, and re-import could never refresh them — the user's edits
// to the BASE mod's map files were invisible on that slot forever.
//
// This fills files still missing after the in-tree merge the way the engine's
// VFS would, from each source in order until nothing is missing:
//   1. the submod's BASE MOD (same resolver as the analysis overlay,
//      modPathResolver.findRelatedModDirs) — its own campaign dir of the same
//      name first (engine precedence), then its world/maps/base, then its
//      data root for shared files;
//   2. the vanilla install (last resort, when a locator is provided) — a mod
//      with no base of its own layers over the game's own data.
// A full mod (its data root carries export_descr_unit.txt) skips step 1: it
// has nothing to inherit from siblings, only from vanilla.
//
// Mutates camp.found in place. Every source root that actually supplied a
// file is reported via onRootUsed — the caller must register it as a
// consented read root, or the renderer's read-file will refuse the very
// paths this returned.

"use strict";

const nodeFs = require("fs");
const nodePath = require("path");
const { findRelatedModDirs } = require("./modPathResolver.js");

// campaigns: [{ name, dir, found: { fileName: fullPath } }] — from a folder scan.
// campaignFiles/sharedFiles: the scan's own file lists (campaign files resolve
// under world/maps/..., shared files at the data root).
// opts: { fs, path, findRelatedModDirs, getVanillaDataDir, onRootUsed, log } —
// all optional; fs/path/resolver injectable for tests.
function fillCampaignFilesFromBase(campaigns, campaignFiles, sharedFiles, opts) {
  const o = opts || {};
  const fs = o.fs || nodeFs;
  const path = o.path || nodePath;
  const findRelated = o.findRelatedModDirs || findRelatedModDirs;
  const onRootUsed = typeof o.onRootUsed === "function" ? o.onRootUsed : () => { };
  const log = typeof o.log === "function" ? o.log : () => { };
  let vanillaDataDir = null;
  if (typeof o.getVanillaDataDir === "function") {
    try { vanillaDataDir = o.getVanillaDataDir() || null; } catch { vanillaDataDir = null; }
  }
  for (const camp of (campaigns || [])) {
    if (!camp || !camp.dir || !camp.found) continue;
    const missing = () => [...campaignFiles, ...sharedFiles].filter((f) => !camp.found[f]);
    if (!missing().length) continue;
    // The campaign dir sits at <dataRoot>/world/maps/campaign/<name>.
    const dataRoot = path.resolve(camp.dir, "..", "..", "..", "..");
    if (!fs.existsSync(path.join(dataRoot, "world"))) continue; // nonstandard layout — don't guess
    const sources = [];
    if (!fs.existsSync(path.join(dataRoot, "export_descr_unit.txt"))) {
      for (const b of (findRelated(dataRoot, "export_descr_unit.txt") || [])) {
        if (path.resolve(b) !== path.resolve(dataRoot)) sources.push(b);
      }
    }
    if (vanillaDataDir && !sources.some((s) => path.resolve(s) === path.resolve(vanillaDataDir))) {
      sources.push(vanillaDataDir);
    }
    for (const srcRoot of sources) {
      if (!missing().length) break;
      const filled = [];
      const tryFill = (file, rel) => {
        if (camp.found[file]) return;
        const p = path.join(srcRoot, rel);
        if (fs.existsSync(p)) { camp.found[file] = p; filled.push(file); }
      };
      for (const f of campaignFiles) {
        tryFill(f, path.join("world", "maps", "campaign", camp.name, f));
        tryFill(f, path.join("world", "maps", "base", f));
      }
      for (const f of sharedFiles) tryFill(f, f);
      if (filled.length) {
        onRootUsed(srcRoot);
        (camp.inheritedFrom = camp.inheritedFrom || []).push(srcRoot);
        log(`campaign "${camp.name}" inherited ${filled.length} file(s) from ${srcRoot}: ${filled.join(", ")}`);
      }
    }
  }
}

module.exports = { fillCampaignFilesFromBase };
