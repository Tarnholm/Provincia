/**
 * Bundles the latest RIS mod files into public/ before each build.
 *
 * Sources (override with env vars):
 *   RIS_MOD_ROOT     → C:\RIS\RIS
 *   RIS_CLASSIC_DIR  → C:\RIS\_submods\RIS_Classic\data\world\maps\campaign\ris_classic
 *
 * Outputs (public/):
 *   descr_sm_factions.txt, <per-campaign>: regions_*.json, factions_with_regions_*.json,
 *   descr_strat_buildings_*.json, population_*.json, resources_*.json, armies_*.json,
 *   descr_win_conditions_*.txt, map_regions_*.tga
 *
 * If a source is missing, the existing file in public/ is left untouched (with a warning).
 */
const fs = require("fs");
const path = require("path");

// parsers.js is ESM (consumed by src/App.js via Vite). Load it via dynamic
// import from this CJS script. The load is async, so the whole pipeline runs
// inside an async main() at the bottom of this file.
let parseDescrRegions, parseDescrStratFactions, parseDescrStratBuildings, parseDescrStratResources, parseDescrStratFactionWealth, parseDescrStratFactionRelationships, parseCampaignScriptDiplomacy, mergeFactionRelationships;
async function loadParsers() {
  const mod = await import("../src/parsers.js");
  parseDescrRegions = mod.parseDescrRegions;
  parseDescrStratFactions = mod.parseDescrStratFactions;
  parseDescrStratBuildings = mod.parseDescrStratBuildings;
  parseDescrStratResources = mod.parseDescrStratResources;
  parseDescrStratFactionWealth = mod.parseDescrStratFactionWealth;
  parseDescrStratFactionRelationships = mod.parseDescrStratFactionRelationships;
  parseCampaignScriptDiplomacy = mod.parseCampaignScriptDiplomacy;
  mergeFactionRelationships = mod.mergeFactionRelationships;
}

// Find the campaign script in a campaign dir (RIS_Campaign_Script.txt,
// campaign_script.txt, etc.) — any *.txt whose name contains "script" and
// whose content uses `console_command`. Returns its text, or "".
function readCampaignScript(campaign) {
  const dirs = [campaign.stratDir, campaign.baseDir].filter(Boolean);
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    const candidates = entries.filter((f) => /\.txt$/i.test(f) && /script/i.test(f));
    // prefer names containing "campaign"
    candidates.sort((a, b) => (/campaign/i.test(b) ? 1 : 0) - (/campaign/i.test(a) ? 1 : 0));
    for (const f of candidates) {
      try {
        const t = fs.readFileSync(path.join(dir, f), "utf8");
        if (/console_command/i.test(t)) { log(`campaign script: ${f}`); return t; }
      } catch {}
    }
  }
  return "";
}

const MOD_ROOT = process.env.RIS_MOD_ROOT || "C:\\RIS\\RIS";
const CLASSIC_DIR = process.env.RIS_CLASSIC_DIR || "C:\\RIS\\_submods\\RIS_Classic\\data\\world\\maps\\campaign\\ris_classic";
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

// Vanilla Rome: Total War Remastered ships its base data under
// Contents/Resources/Data (Feral layout, same on Windows). Slot 2 bundles the
// vanilla imperial campaign so a fresh install always has a real map to explore
// before the user imports a mod. Override with VANILLA_RTW_DATA.
const VANILLA_ROOT = process.env.VANILLA_RTW_DATA ||
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data";

const CAMPAIGNS = [
  {
    // Slot 1: intentionally EMPTY by default — a fresh install prompts the user
    // to import their own mod here (see onboarding). Set BUNDLE_CLASSIC=1 to
    // populate it from RIS_Classic instead.
    suffix: "classic",
    mapHeight: 350,
    stratDir: CLASSIC_DIR,
    baseDir: null, // classic has all files in its campaign dir
    empty: !process.env.BUNDLE_CLASSIC,
  },
  {
    // Slot 2: vanilla Rome imperial campaign (NOT the mod) — the out-of-the-box
    // map. Set RIS_MOD_ROOT-style override via VANILLA_RTW_DATA if the install
    // lives elsewhere.
    suffix: "large",
    mapHeight: 700,
    stratDir: path.join(VANILLA_ROOT, "data", "world", "maps", "campaign", "imperial_campaign"),
    baseDir: path.join(VANILLA_ROOT, "data", "world", "maps", "base"),
  },
];

function log(msg) { console.log(`[bundle] ${msg}`); }
function warn(msg) { console.warn(`[bundle] WARN: ${msg}`); }

// Locate a file in campaign dir, fall back to base dir
function findSource(campaign, name) {
  const primary = path.join(campaign.stratDir, name);
  if (fs.existsSync(primary)) return primary;
  if (campaign.baseDir) {
    const fallback = path.join(campaign.baseDir, name);
    if (fs.existsSync(fallback)) return fallback;
  }
  return null;
}

function copyRaw(src, dstName) {
  const dst = path.join(PUBLIC_DIR, dstName);
  fs.copyFileSync(src, dst);
  log(`copied ${path.basename(src)} → public/${dstName}`);
}

function derivePopulation(stratBuildings) {
  const pop = {};
  for (const f of stratBuildings) {
    for (const s of f.settlements || []) {
      if (s.region && typeof s.population === "number") pop[s.region] = s.population;
    }
  }
  return pop;
}

// ── Starting-armies parser/builder — extracted to a shared CommonJS module ──
// src/startingArmiesBuilder.js is the SOLE source of this logic now (it also
// feeds the live "auto-refresh starting armies" IPC in main.js). The bundle
// output (public/starting_armies_<suffix>.json) MUST stay byte-identical to the
// previous inline copy — verified via the bundle-parity diff.
const { parseArmiesClassified, buildStartingArmiesByRegion } = require("../src/startingArmiesBuilder.js");


// ── Build ─────────────────────────────────────────────────────────────────

function writeJson(dstName, data) {
  const dst = path.join(PUBLIC_DIR, dstName);
  fs.writeFileSync(dst, JSON.stringify(data, null, 2), "utf8");
  log(`wrote public/${dstName}`);
}

function copyFactionIcons() {
  const src = path.join(MOD_ROOT, "data", "ui", "faction_icons");
  const dst = path.join(PUBLIC_DIR, "faction_icons");
  if (!fs.existsSync(src)) { warn(`faction_icons dir not found at ${src} — skipping icon bundle`); return; }
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(src)) {
    if (!name.toLowerCase().endsWith(".tga")) continue;
    fs.copyFileSync(path.join(src, name), path.join(dst, name));
    copied++;
  }
  log(`copied ${copied} faction icons → public/faction_icons/`);
}

function run() {
  log(`MOD_ROOT=${MOD_ROOT}`);
  log(`CLASSIC_DIR=${CLASSIC_DIR}`);

  // 1. Shared file: descr_sm_factions.txt
  const smPath = path.join(MOD_ROOT, "data", "descr_sm_factions.txt");
  if (fs.existsSync(smPath)) copyRaw(smPath, "descr_sm_factions.txt");
  else warn(`descr_sm_factions.txt not found at ${smPath} (leaving existing public/ copy)`);

  // 1b. Faction icons — bundled so first launch has visuals before user imports a mod
  copyFactionIcons();

  // 2. Per-campaign files
  for (const c of CAMPAIGNS) {
    if (c.empty) {
      // Ship an empty slot: blank JSON outputs + remove any stale map/raw
      // copies so the app shows an "import a mod" prompt instead of old data.
      // IMPORTANT: each empty file must keep the SAME shape consumers expect —
      // arrays for armies/buildings, objects for the region/faction maps — or
      // a `.map`/`Object.keys` on the wrong type throws and white-screens the app.
      log(`--- campaign: ${c.suffix} (EMPTY by default — fresh import slot) ---`);
      writeJson(`regions_${c.suffix}.json`, {});                  // region map keyed by RGB
      writeJson(`factions_with_regions_${c.suffix}.json`, {});    // keyed by faction name (OBJECT)
      writeJson(`faction_wealth_${c.suffix}.json`, {});
      writeJson(`faction_relationships_${c.suffix}.json`, {});
      writeJson(`descr_strat_buildings_${c.suffix}.json`, []);    // ARRAY of factions
      writeJson(`population_${c.suffix}.json`, {});
      writeJson(`resources_${c.suffix}.json`, {});
      writeJson(`armies_${c.suffix}.json`, []);                   // ARRAY of armies
      writeJson(`starting_armies_${c.suffix}.json`, {});
      for (const stale of [`map_regions_${c.suffix}.tga`, `descr_win_conditions_${c.suffix}.txt`, `map_ground_types_${c.suffix}.tga`, `map_heights_${c.suffix}.tga`]) {
        const p = path.join(PUBLIC_DIR, stale);
        if (fs.existsSync(p)) { fs.unlinkSync(p); log(`removed stale public/${stale}`); }
      }
      continue;
    }
    log(`--- campaign: ${c.suffix} (${c.stratDir}) ---`);
    const regionsPath = findSource(c, "descr_regions.txt");
    const stratPath = findSource(c, "descr_strat.txt");
    const winPath = findSource(c, "descr_win_conditions.txt");
    const mapPath = findSource(c, "map_regions.tga");

    if (!regionsPath) { warn(`descr_regions.txt missing for ${c.suffix} — skipping campaign`); continue; }
    if (!stratPath)   { warn(`descr_strat.txt missing for ${c.suffix} — skipping campaign`); continue; }

    // Raw copies
    if (winPath) copyRaw(winPath, `descr_win_conditions_${c.suffix}.txt`);
    else warn(`descr_win_conditions.txt missing for ${c.suffix}`);
    if (mapPath) copyRaw(mapPath, `map_regions_${c.suffix}.tga`);
    else warn(`map_regions.tga missing for ${c.suffix}`);

    // Terrain layer — used by the Geography view mode to render per-tile
    // ground types (forest, mountain, sand, etc.). 1020×700 in vanilla RTW;
    // Remastered ships a 2x-supersampled (2041×1401) version too which we
    // sample at 2× stride.
    const groundPath = findSource(c, "map_ground_types.tga");
    if (groundPath) copyRaw(groundPath, `map_ground_types_${c.suffix}.tga`);
    else warn(`map_ground_types.tga missing for ${c.suffix}`);

    // Heights layer (elevation, grayscale R-channel). Independent overlay.
    const heightsPath = findSource(c, "map_heights.tga");
    if (heightsPath) copyRaw(heightsPath, `map_heights_${c.suffix}.tga`);
    else warn(`map_heights.tga missing for ${c.suffix}`);

    // Parse regions
    const regionsText = fs.readFileSync(regionsPath, "utf8");
    const regions = parseDescrRegions(regionsText);
    writeJson(`regions_${c.suffix}.json`, regions);

    // Parse strat
    const stratText = fs.readFileSync(stratPath, "utf8");
    const factions = parseDescrStratFactions(stratText);
    writeJson(`factions_with_regions_${c.suffix}.json`, factions);

    const wealth = parseDescrStratFactionWealth(stratText);
    writeJson(`faction_wealth_${c.suffix}.json`, wealth);

    const stratRelationships = parseDescrStratFactionRelationships(stratText);
    const scriptText = readCampaignScript(c);
    const scriptRelationships = scriptText ? parseCampaignScriptDiplomacy(scriptText) : null;
    const relationships = mergeFactionRelationships(scriptRelationships, stratRelationships);
    writeJson(`faction_relationships_${c.suffix}.json`, relationships);

    const stratBuildings = parseDescrStratBuildings(stratText);
    writeJson(`descr_strat_buildings_${c.suffix}.json`, stratBuildings);

    writeJson(`population_${c.suffix}.json`, derivePopulation(stratBuildings));

    // TGA-dependent parsers
    let tgaBuf = null;
    if (mapPath) tgaBuf = fs.readFileSync(mapPath);

    // Derive the map height from the ACTUAL region TGA, not the hardcoded
    // slot default — vanilla Rome's region map is 255×156, RIS's is 1020×700,
    // and the descr_strat Y coords are flipped against the real map height.
    // Using the wrong height mis-places every resource and army.
    const mapHeight = tgaBuf ? tgaBuf.readUInt16LE(14) : c.mapHeight;
    if (tgaBuf && mapHeight !== c.mapHeight) log(`${c.suffix}: map height ${mapHeight} (TGA) overrides slot default ${c.mapHeight}`);

    const resources = parseDescrStratResources(stratText, mapHeight, tgaBuf, regions);
    writeJson(`resources_${c.suffix}.json`, resources);

    const armies = parseArmiesClassified(stratText, tgaBuf, mapHeight);
    writeJson(`armies_${c.suffix}.json`, armies);

    // Build starting_armies_<suffix>.json: { region: { settlement: {x,y},
    // garrison: [armies], field: [armies] } }. Mirrors the per-region
    // classification the dev-import flow produces. Without this, slave
    // settlements (and any other settlement using `garrisoned_army` rather
    // than character-based armies) show empty in the region info panel.
    if (tgaBuf) {
      const startingByRegion = buildStartingArmiesByRegion(armies, tgaBuf, regions, factions);
      writeJson(`starting_armies_${c.suffix}.json`, startingByRegion);
    }
  }

  log("done.");
}

(async () => {
  try {
    await loadParsers();
    run();
  } catch (e) {
    console.error("[bundle] FATAL:", e.stack || e.message);
    process.exit(1);
  }
})();
