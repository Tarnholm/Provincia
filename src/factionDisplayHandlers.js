// Faction display-name / culture / initial-ownership IPC handlers
// (faction-display-map, faction-display-names, faction-cultures,
// get-initial-ownership, get-initial-creators) + their _factionDisplayCache /
// _factionCultureCache LRUs and CAMPAIGN_PREFIX, extracted verbatim from
// main.js (2026-07-17). Mutable main.js mod state is injected via getters
// (modFactionCultures also via a setter). clearFactionDisplayCaches() is
// exported for main.js's clear-mod-caches / factory-reset handlers — note the
// old inline `_factionCultureCache.clear()` calls silently threw (makeLRU has
// no .clear); the exported function actually clears by reassigning fresh
// LRUs. Handler logic otherwise unchanged.
"use strict";
const fs = require("fs");
const path = require("path");
const { makeLRU } = require("./mainUtils.js");
const { getIconSearchRoots, findRelatedModDirs } = require("./modPathResolver.js");

let _factionDisplayCache = makeLRU(16); // let (was const): clearFactionDisplayCaches reassigns
const CAMPAIGN_PREFIX = {
  classic: ["ALTERNATE_CAMPAIGN", "RIS_CLASSIC", "RIS_CLASSIC_2"],
  imperial: ["IMPERIAL_CAMPAIGN"],
};
let _factionCultureCache = makeLRU(16); // let (was const): clearFactionDisplayCaches reassigns

// Drop both LRUs (mod reload / factory reset). Reassignment, not .clear() —
// makeLRU exposes no clear method.
function clearFactionDisplayCaches() {
  _factionDisplayCache = makeLRU(16);
  _factionCultureCache = makeLRU(16);
}

function registerFactionDisplayHandlers(ipcMain, {
  getModFactionDisplayMap,
  getModInitialOwnerByCity,
  getModInitialCreatorByCity,
  getModFactionCultures,
  setModFactionCultures,
}) {

// Load mod-specific name/trait tables so subsequent save parses can decode
// characters. Called by the renderer once the user has selected the mod data
// directory. Idempotent — safe to call multiple times.
// Returns the current faction display-name → internal-id map, so the renderer
// can match "House of Claudii" → romans_julii without filename-pattern tricks.
ipcMain.handle("faction-display-map", async () => {
  return getModFactionDisplayMap() || {};
});

// Self-contained — parses expanded_bi.txt files from mod + game installs
// so users without a mod selected still get faction display names.
// Also reads campaign_descriptions.txt for campaign-specific names like
// "The House of Claudii" (RIS alternate_campaign) vs "Rome" (imperial).
// Pass the campaign id (e.g., "classic" → "alternate_campaign") so the
// matching campaign's titles override the generic expanded_bi entries.
ipcMain.handle("faction-display-names", async (_event, modDataDir, campaign) => {
  const cacheKey = `${modDataDir || ""}|${campaign || ""}`;
  if (_factionDisplayCache.has(cacheKey)) return _factionDisplayCache.get(cacheKey);
  const map = {};
  const sources = [];
  for (const root of getIconSearchRoots()) {
    sources.push(path.join(root, "text", "expanded_bi.txt"));
  }
  for (const d of findRelatedModDirs(modDataDir, "text/expanded_bi.txt").reverse()) {
    sources.push(path.join(d, "text", "expanded_bi.txt"));
  }
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const buf = fs.readFileSync(src);
      const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\{([A-Z][A-Z0-9_]*)\}\s*(.+?)\s*$/);
        if (!m) continue;
        const key = m[1];
        if (key.includes("_DESCR") || key.startsWith("EMT_") || key.startsWith("SMW_") ||
            key.endsWith("_LABEL") || key.endsWith("_ORDER") || key.endsWith("_UNREST") ||
            key.endsWith("_TITLE") || key.endsWith("_BODY") || key.endsWith("_MESSAGE")) continue;
        const factionId = key.toLowerCase();
        const display = m[2].trim();
        if (!display || display.length > 60) continue;
        map[factionId] = display;
      }
    } catch {}
  }
  // Layer campaign-specific titles on top so the active campaign's faction
  // names (e.g., "The House of Claudii" in alternate_campaign) override
  // generic ones (e.g., "The Roman Republic" from expanded_bi.txt).
  const prefixes = CAMPAIGN_PREFIX[campaign] || [];
  if (prefixes.length) {
    const campSources = [];
    for (const root of getIconSearchRoots()) {
      campSources.push(path.join(root, "text", "campaign_descriptions.txt"));
    }
    for (const d of findRelatedModDirs(modDataDir, "text/campaign_descriptions.txt").reverse()) {
      campSources.push(path.join(d, "text", "campaign_descriptions.txt"));
    }
    for (const src of campSources) {
      if (!fs.existsSync(src)) continue;
      try {
        const buf = fs.readFileSync(src);
        const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          const m = line.match(/^\{([A-Z0-9_]+)_TITLE\}(.+?)\s*$/);
          if (!m) continue;
          const key = m[1];
          let factionId = null;
          for (const p of prefixes) {
            if (key.startsWith(p + "_")) {
              factionId = key.slice(p.length + 1).toLowerCase();
              break;
            }
          }
          if (!factionId) continue;
          const display = m[2].trim();
          if (!display || display.length > 60) continue;
          map[factionId] = display;
        }
      } catch {}
    }
  }
  _factionDisplayCache.set(cacheKey, map);
  return map;
});

// IPC: return faction → culture map, merged from mod + vanilla + Alexander.
// Self-contained — doesn't depend on charactersInit having been called.
// Users who haven't selected a mod path still get vanilla + Alexander data.
ipcMain.handle("faction-cultures", async (_event, modDataDir) => {
  const cacheKey = modDataDir || "";
  if (_factionCultureCache.has(cacheKey)) return _factionCultureCache.get(cacheKey);
  const map = {};
  const sources = [];
  // Mod first (first-wins — mod overrides fallbacks).
  for (const d of findRelatedModDirs(modDataDir, "descr_sm_factions.txt")) {
    sources.push(path.join(d, "descr_sm_factions.txt"));
  }
  // Game install fallbacks.
  for (const root of getIconSearchRoots()) {
    sources.push(path.join(root, "descr_sm_factions.txt"));
  }
  for (const src of sources) {
    if (!fs.existsSync(src)) continue;
    try {
      const text = fs.readFileSync(src, "utf8");
      let curFaction = null;
      for (const line of text.split(/\r?\n/)) {
        const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
        if (fm) { curFaction = fm[1]; continue; }
        if (curFaction) {
          const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
          if (cm) {
            if (!(curFaction in map)) map[curFaction] = cm[1];
            curFaction = null;
          }
        }
      }
    } catch {}
  }
  _factionCultureCache.set(cacheKey, map);
  // Also update the legacy var so other code paths see it.
  if (!getModFactionCultures() || Object.keys(getModFactionCultures()).length === 0) {
    setModFactionCultures(map);
  }
  return map;
});

// Expose the turn-0 settlement ownership map (settlementName → factionId)
// to the renderer without needing a save loaded. Without this, the recruit
// evaluator falls back to descr_regions.txt's rebel-default faction, which
// for some regions points to a faction that doesn't actually own the
// settlement at game start (Corsica is rebel-default romans_julii but the
// actual descr_strat owner is corsi). That misresolves ownerId and shows
// the wrong faction's recruits.
ipcMain.handle("get-initial-ownership", async () => {
  return getModInitialOwnerByCity() || {};
});

// 0.9.437: descr_strat `faction_creator` per settlement — the rebel-default
// recorded by descr_strat. Distinct from the parent-faction current owner
// returned by get-initial-ownership. Loyalist map mode uses this to compare
// against descr_regions field 3 (also a rebel-default).
ipcMain.handle("get-initial-creators", async () => {
  return getModInitialCreatorByCity() || {};
});
}

module.exports = { registerFactionDisplayHandlers, clearFactionDisplayCaches };
