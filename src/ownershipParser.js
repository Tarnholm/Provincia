// src/ownershipParser.js
//
// Parses descr_regions.txt and descr_strat.txt to produce a map of
// settlement name -> starting faction id. Used by the app as the turn-0
// ground truth for who owns what. In-save conquests are not tracked by
// this parser (see calibration/PROGRESS_LOG.md Round 21 — the save's
// faction-owned-settlements list requires a full serialization parser).

"use strict";

const fs = require("fs");
const path = require("path");

function findCampaignDescrStrat(modDataDir) {
  // Prefer a campaign subfolder whose descr_strat.txt exists.
  const campaignDir = path.join(modDataDir, "world", "maps", "campaign");
  if (fs.existsSync(campaignDir)) {
    const candidates = ["ris_classic", "imperial_campaign"];
    for (const c of candidates) {
      const p = path.join(campaignDir, c, "descr_strat.txt");
      if (fs.existsSync(p)) return p;
    }
    try {
      for (const entry of fs.readdirSync(campaignDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const p = path.join(campaignDir, entry.name, "descr_strat.txt");
        if (fs.existsSync(p)) return p;
      }
    } catch {}
  }
  // Fallback: flat layout (e.g., loose test folder)
  const flat = path.join(modDataDir, "descr_strat.txt");
  if (fs.existsSync(flat)) return flat;
  return null;
}

function findDescrRegions(modDataDir, campaignName) {
  // Prefer a campaign-specific descr_regions (Alexander uses a different set
  // of regions than the base map — e.g., "Macedon"/"Greece" that don't exist
  // in the shared base file).
  const candidates = [];
  if (campaignName) {
    candidates.push(path.join(modDataDir, "world", "maps", "campaign", campaignName, "descr_regions.txt"));
  }
  candidates.push(
    path.join(modDataDir, "world", "maps", "base", "descr_regions.txt"),
    path.join(modDataDir, "world", "maps", "descr_regions.txt"),
    path.join(modDataDir, "descr_regions.txt"),
  );
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

// Parse descr_regions.txt to extract { regionName: settlementName }.
// Format per region block (separated by blank lines, ignoring comments):
//   RegionName
//       SettlementName
//       initial_owner_faction
//       rebel_name
//       ... more lines
function parseDescrRegions(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const regionToSettlement = {};
  let state = "idle";
  let currentRegion = null;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trimEnd();
    if (state === "idle") {
      // Looking for a region name: non-indented, non-empty, no leading tab.
      if (line && !line.startsWith("\t") && !line.startsWith(" ")) {
        const name = line.trim();
        if (/^[A-Za-z][A-Za-z0-9_\-]*$/.test(name)) {
          currentRegion = name;
          state = "wantSettlement";
        }
      }
    } else if (state === "wantSettlement") {
      const settlement = line.trim();
      if (settlement) {
        regionToSettlement[currentRegion] = settlement;
        state = "idle";
        currentRegion = null;
      }
    }
  }
  return regionToSettlement;
}

// Parse descr_strat.txt extracting { factionId: [regionName, ...] } plus a
// per-region `faction_creator` map.
// Structure:
//   faction <faction_id>, <ai_type>
//   ... various lines including settlement { ... region <R> ... faction_creator <F> ... } blocks
//   (blocks continue until the next `faction <id>` line)
// Returns: { factionRegions, regionCreator }
// regionCreator maps regionName → faction_creator id (descr_strat rebel-
// default per settlement). Used by loyalist map mode to compare descr_strat
// rebel-default to descr_regions rebel-default (field 3).
function parseDescrStrat(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const factionRegions = {};
  const regionCreator = {};
  let currentFaction = null;
  let inSettlement = false;
  let curRegion = null;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const fmatch = line.match(/^faction\s+([A-Za-z0-9_]+)\s*,/);
    if (fmatch) {
      currentFaction = fmatch[1];
      if (!factionRegions[currentFaction]) factionRegions[currentFaction] = [];
      inSettlement = false;
      curRegion = null;
      continue;
    }
    if (line === "settlement") { inSettlement = true; curRegion = null; continue; }
    if (inSettlement) {
      const rmatch = line.match(/^region\s+([A-Za-z][A-Za-z0-9_\-]*)/);
      if (rmatch && currentFaction) {
        factionRegions[currentFaction].push(rmatch[1]);
        curRegion = rmatch[1];
        continue;
      }
      const cmatch = line.match(/^faction_creator\s+([A-Za-z0-9_]+)/);
      if (cmatch && curRegion) {
        regionCreator[curRegion] = cmatch[1];
        continue;
      }
      // End-of-block on closing brace.
      if (line === "}") { inSettlement = false; curRegion = null; }
    }
  }
  return { factionRegions, regionCreator };
}

// Build { settlementName: factionId } using descr_strat ownership and
// descr_regions' region->settlement mapping.
function buildInitialOwnership(modDataDir) {
  const stratPath = findCampaignDescrStrat(modDataDir);
  // Derive campaign name from the strat path (…/campaign/<name>/descr_strat.txt)
  const campaignName = stratPath
    ? path.basename(path.dirname(stratPath))
    : null;
  const regionsPath = findDescrRegions(modDataDir, campaignName);
  if (!stratPath || !regionsPath) {
    return { ownerByCity: {}, error: `descr_strat=${!!stratPath} descr_regions=${!!regionsPath}` };
  }
  const regionToSettlement = parseDescrRegions(regionsPath);
  const stratParsed = parseDescrStrat(stratPath);
  const { factionRegions, regionCreator } = stratParsed;
  const ownerByCity = {};
  for (const [faction, regions] of Object.entries(factionRegions)) {
    for (const r of regions) {
      const s = regionToSettlement[r];
      if (s) ownerByCity[s] = faction;
    }
  }
  // 0.9.437: per-settlement `faction_creator` (descr_strat rebel-default).
  // Loyalist map mode compares this to descr_regions field 3 (also a rebel-
  // default) to determine when a settlement's REAL homeland matches the
  // rebellion target — if they agree, the settlement is loyal.
  const creatorByCity = {};
  for (const [region, creator] of Object.entries(regionCreator || {})) {
    const s = regionToSettlement[region];
    if (s) creatorByCity[s] = creator;
  }
  return {
    ownerByCity,
    creatorByCity,
    stats: {
      regions: Object.keys(regionToSettlement).length,
      factionsWithSettlements: Object.keys(factionRegions).filter((f) => factionRegions[f].length > 0).length,
      settlementsOwned: Object.keys(ownerByCity).length,
      creatorsRecorded: Object.keys(creatorByCity).length,
    },
    stratPath,
    regionsPath,
  };
}

module.exports = {
  findCampaignDescrStrat,
  findDescrRegions,
  parseDescrRegions,
  parseDescrStrat,
  buildInitialOwnership,
};
