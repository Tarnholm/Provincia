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
// Folders that hold copies, never the mod a user means to load. Picking a mod
// repo root (C:/RIS) listed _resources/backups/alternate_campaign as a
// campaign, and loading it filled the map with a months-old descr_strat
// (user report 2026-09-22: a phantom "roman_senate" Marcus in Roma).
const SKIP_DIRS = /^(_?backups?|_resources|_old|_?archive|\.git|node_modules|wiki|wiki-pages|wiki-notes)$/i;

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
        if (SKIP_DIRS.test(entry.name)) continue;
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
  // Two MODS may both ship imperial_campaign (RIS and RIS_Four_Romans): those
  // are different campaigns and both are listed. Only same-named folders of
  // one mod (a stray copy inside it) collapse. A standard campaign's mod is
  // the data root four levels up (data/world/maps/campaign/<name>).
  // A campaign's mod is its nearest "data" folder: RTW Remastered keeps a copy
  // of the campaign under data/original_overrides/resource_quantity/..., and
  // that copy belongs to the same mod (four-levels-up made it a mod of its own,
  // and a reload then picked the override copy over the real campaign).
  const modOf = (c) => {
    let d = path.resolve(c.dir);
    for (let i = 0; i < 10; i++) {
      if (path.basename(d).toLowerCase() === "data") return d.toLowerCase();
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
    return "";
  };
  const isOverride = (c) => /[\\/]original_overrides[\\/]/i.test(c.dir);
  const byName = new Map();
  for (const c of found) {
    const key = c.name.toLowerCase() + "|" + modOf(c);
    const existing = byName.get(key);
    const nc = Object.keys(c.found).length, ne = existing ? Object.keys(existing.found).length : -1;
    // fullest wins; on a tie the real campaign beats its override copy
    if (!existing || nc > ne || (nc === ne && isOverride(existing) && !isOverride(c))) byName.set(key, c);
  }
  const campaigns = [...byName.values()];

  // RTW inheritance: a campaign dir takes what it lacks from ITS OWN mod's
  // base/ (…/data/world/maps/campaign/<name> → …/data/world/maps/base) and its
  // own data root's shared files. `baseFound` is simply the last base/ the walk
  // met, so with several mods under the picked folder (a repo root holding a
  // main mod and its submods) it handed every campaign some other mod's
  // descr_regions and map_regions. It stays as the fallback for a lone base/.
  const own = (p) => dirFiles.get(path.resolve(p)) || dirFiles.get(p) || null;
  for (const c of campaigns) {
    const isStd = path.basename(path.dirname(c.dir)).toLowerCase() === "campaign";
    const ownBase = isStd ? own(path.join(c.dir, "..", "..", "base")) : null;
    const ownData = isStd ? own(path.join(c.dir, "..", "..", "..", "..")) : null;
    for (const f of CAMPAIGN_FILES) if (!c.found[f]) {
      if (ownBase && ownBase[f]) c.found[f] = ownBase[f];
      // a standard campaign with no base/ of its own is a submod: leave the gap
      // for fillCampaignFilesFromBase below, which finds ITS base mod
      else if (!isStd && baseFound[f]) c.found[f] = baseFound[f];
    }
    for (const sf of SHARED_FILES) if (!c.found[sf]) {
      if (ownData && ownData[sf]) c.found[sf] = ownData[sf];
      else if (sharedFound[sf]) c.found[sf] = sharedFound[sf];
    }
    // where it came from, for the picker: two mods can both ship imperial_campaign
    c.rel = path.relative(dir, c.dir) || path.basename(c.dir);
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
