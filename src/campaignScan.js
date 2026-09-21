// The ONE campaign-folder scanner (2026-09-21).
//
// There were two: scanFolderForCampaigns in main.js (scan-folder — the silent
// re-import at launch) and a near-copy inlined in select-folder. Every change
// had to land in both, and they had drifted: only the picker de-duplicated
// same-named campaigns (keeping the fullest), so a launch re-import could
// resolve a DIFFERENT campaign folder than the one the user originally picked;
// only the picker returned baseFound. Both handlers call this now.
//
// Walks `dir` (depth ≤ 7) for the campaign files, groups hits per directory:
//   • a dir holding descr_strat.txt is a campaign;
//   • a dir named "base" holding any campaign file provides the inherited ones;
//   • shared files (descr_sm_factions.txt) are taken from the first dir seen.
// Same-named campaigns collapse to the one with the most files. Whatever is
// STILL missing is inherited from the submod's base mod, vanilla last
// (src/baseModFallback.js) — every root used there is reported via onRootUsed
// so the caller can consent it for read-file.
"use strict";
const fs = require("fs");
const path = require("path");

// map_heights.tga + map_ground_types.tga (2026-07-16): the Heights, Terrain and
// Geography overlays sample these; dropping them from this list broke all three
// on imported slots (v0.9.1301). The list is load-bearing — do not trim it.
const CAMPAIGN_FILES = ["descr_regions.txt", "descr_strat.txt", "descr_win_conditions.txt", "map_regions.tga", "map_heights.tga", "map_ground_types.tga"];
const SHARED_FILES = ["descr_sm_factions.txt"];

function scanFolderForCampaigns(dir, opts) {
  const o = opts || {};
  const log = typeof o.log === "function" ? o.log : () => { };
  const allNeeded = [...CAMPAIGN_FILES, ...SHARED_FILES];
  const neededLc = new Map(allNeeded.map((n) => [n.toLowerCase(), n]));

  const dirFiles = new Map(); // dirPath → { fileName: fullPath }
  const unreadable = [];
  const scan = (dirPath, depth) => {
    if (depth > 7) return;
    let entries;
    // A folder we cannot list used to vanish silently — and with it the campaign
    // inside, which then looked like "Provincia doesn't see my campaign".
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
    catch (e) { unreadable.push(`${dirPath} (${e && e.code ? e.code : e && e.message})`); return; }
    for (const entry of entries) {
      if (entry.isFile()) {
        const n = neededLc.get(entry.name.toLowerCase());
        if (n) {
          if (!dirFiles.has(dirPath)) dirFiles.set(dirPath, {});
          dirFiles.get(dirPath)[n] = path.join(dirPath, entry.name);
        }
      } else if (entry.isDirectory()) {
        scan(path.join(dirPath, entry.name), depth + 1);
      }
    }
  };
  scan(dir, 0);
  if (unreadable.length) log(`could not list ${unreadable.length} folder(s): ${unreadable.slice(0, 5).join("; ")}${unreadable.length > 5 ? " …" : ""}`);

  const found = [];
  let baseFound = {};
  const sharedFound = {};
  for (const [dirPath, files] of dirFiles) {
    const dirName = path.basename(dirPath).toLowerCase();
    if (dirName === "base" && CAMPAIGN_FILES.some((f) => files[f])) baseFound = { ...files };
    else if (files["descr_strat.txt"]) found.push({ name: path.basename(dirPath), dir: dirPath, found: { ...files } });
    for (const sf of SHARED_FILES) if (files[sf] && !sharedFound[sf]) sharedFound[sf] = files[sf];
  }

  // Same folder name twice (a backup copy deeper in the tree) → keep the fullest.
  const byName = new Map();
  for (const c of found) {
    const key = c.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || Object.keys(c.found).length > Object.keys(existing.found).length) byName.set(key, c);
  }
  const campaigns = [...byName.values()];

  // RTW inheritance: a campaign dir takes what it lacks from base/.
  for (const c of campaigns) {
    for (const f of CAMPAIGN_FILES) if (!c.found[f] && baseFound[f]) c.found[f] = baseFound[f];
    for (const sf of SHARED_FILES) if (!c.found[sf] && sharedFound[sf]) c.found[sf] = sharedFound[sf];
  }

  // Submod trees ship only the files they change (2026-08-06): inherit what is
  // STILL missing from the submod's base mod, vanilla install last.
  try {
    const { fillCampaignFilesFromBase } = require("./baseModFallback.js");
    fillCampaignFilesFromBase(campaigns, CAMPAIGN_FILES, SHARED_FILES, {
      getVanillaDataDir: o.getVanillaDataDir, onRootUsed: o.onRootUsed, log,
    });
    for (const c of campaigns) for (const sf of SHARED_FILES) if (c.found[sf] && !sharedFound[sf]) sharedFound[sf] = c.found[sf];
  } catch (e) { log(`base-mod inheritance failed: ${e && e.message}`); }

  return { dir, campaigns, baseFound, sharedFound };
}

module.exports = { scanFolderForCampaigns, CAMPAIGN_FILES, SHARED_FILES };
