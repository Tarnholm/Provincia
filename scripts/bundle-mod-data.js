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

// Shared parsers (imported via CJS — same module App.js imports via ES interop)
const {
  parseDescrRegions,
  parseDescrStratFactions,
  parseDescrStratBuildings,
  parseDescrStratResources,
} = require("../src/parsers");

const MOD_ROOT = process.env.RIS_MOD_ROOT || "C:\\RIS\\RIS";
const CLASSIC_DIR = process.env.RIS_CLASSIC_DIR || "C:\\RIS\\_submods\\RIS_Classic\\data\\world\\maps\\campaign\\ris_classic";
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const CAMPAIGNS = [
  {
    suffix: "classic",
    mapHeight: 350,
    stratDir: CLASSIC_DIR,
    baseDir: null, // classic has all files in its campaign dir
  },
  {
    suffix: "large",
    mapHeight: 700,
    stratDir: path.join(MOD_ROOT, "data", "world", "maps", "campaign", "imperial_campaign"),
    baseDir: path.join(MOD_ROOT, "data", "world", "maps", "base"),
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

// ── Minimal TGA reader — supports uncompressed 24/32-bit BGR(A) ──────────
function readTga(buf) {
  const idLen = buf[0];
  const w = buf[12] | (buf[13] << 8);
  const h = buf[14] | (buf[15] << 8);
  const bpp = buf[16];
  const stride = bpp / 8;
  const dataOff = 18 + idLen;
  // Strat coords: origin bottom-left, so TGA's bottom-left origin needs no flip
  const getPixel = (sx, sy) => {
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return null;
    const idx = dataOff + (sy * w + sx) * stride;
    // TGA stores BGR
    return [buf[idx + 2], buf[idx + 1], buf[idx]];
  };
  return { w, h, getPixel };
}

// ── Armies parser (richer than parsers.js — needs TGA for garrison classification) ──
// Ported from scripts/parse_armies.py
const CHAR_RE = /^character,?\s+(.+)/;
const COORD_RE = /x\s+(\d+),\s*y\s+(\d+)/;
const UNIT_RE = /^unit\s+(.+?)(?:\s+exp\s|$)/;

function isSea(r, g, b) { return r < 60 && g >= 120 && g <= 160 && b >= 200; }

function findCityPixel(sx, sy, getPixel, radius) {
  let best = null, bestD2 = radius * radius + 1;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      const p = getPixel(sx + dx, sy + dy);
      if (p && p[0] === 0 && p[1] === 0 && p[2] === 0 && d2 < bestD2) {
        bestD2 = d2; best = [sx + dx, sy + dy];
      }
    }
  }
  return best;
}

function armyClass(charLine, comment, sx, sy, getPixel) {
  const cl = charLine.toLowerCase();
  const co = comment.toLowerCase();
  if (cl.includes("admiral") || co.startsWith(";port of") || co.includes("(sea)")) return ["navy", sx, sy];
  if (co.startsWith(";outside") || co.startsWith(";near") || co.startsWith(";field")) return ["field", sx, sy];
  if (co.includes("(field)") || co.includes("(outside)")) return ["field", sx, sy];
  if (!comment.startsWith(";")) return ["field", sx, sy];
  const center = getPixel(sx, sy);
  if (center && isSea(center[0], center[1], center[2])) return ["field", sx, sy];
  const city = findCityPixel(sx, sy, getPixel, 3);
  if (city) return ["garrison", city[0], city[1]];
  return ["field", sx, sy];
}

function charType(line) {
  const l = line.toLowerCase();
  if (l.includes("admiral")) return "admiral";
  if (l.includes("spy")) return "spy";
  if (l.includes("diplomat")) return "diplomat";
  if (l.includes("merchant")) return "merchant";
  return "general";
}

function parseArmiesClassified(text, tgaBuf, mapHeight) {
  const tga = tgaBuf ? readTga(tgaBuf) : null;
  const getPixel = tga ? tga.getPixel : () => null;
  const armies = [];
  let faction = null, current = null, inArmy = false, prevComment = "";
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const s = rawLine.replace(/\s+$/, "");
    const fm = /^faction\s+(\w+)/.exec(s);
    if (fm) {
      if (current && current.units.length) armies.push(current);
      faction = fm[1]; current = null; inArmy = false; prevComment = "";
      continue;
    }
    if (s.trim().startsWith(";") && !/^character,/.test(s)) prevComment = s.trim();
    const cm = CHAR_RE.exec(s);
    if (cm) {
      if (current && current.units.length) armies.push(current);
      inArmy = false;
      const rest = cm[1];
      const coord = COORD_RE.exec(rest);
      if (!coord) { current = null; prevComment = ""; continue; }
      const sx = parseInt(coord[1]), sy = parseInt(coord[2]);
      const name = rest.split(",")[0].trim().replace(/_/g, " ");
      const [ac, snapX, snapY] = armyClass(rest, prevComment, sx, sy, getPixel);
      const loc = prevComment.startsWith(";") ? prevComment.replace(/^;/, "").trim() : "";
      current = {
        name, charType: charType(rest), armyClass: ac, location: loc, faction,
        x: snapX,
        y: mapHeight - 1 - snapY,
        units: [],
      };
      prevComment = "";
      continue;
    }
    if (s.trim() === "army") { inArmy = true; continue; }
    if (inArmy && current) {
      const um = UNIT_RE.exec(s.trim());
      if (um) current.units.push(um[1].trim());
      else if (s.trim() && !/^\s/.test(s) && s[0] !== "\t") inArmy = false;
    }
  }
  if (current && current.units.length) armies.push(current);
  return armies;
}

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

    // Parse regions
    const regionsText = fs.readFileSync(regionsPath, "utf8");
    const regions = parseDescrRegions(regionsText);
    writeJson(`regions_${c.suffix}.json`, regions);

    // Parse strat
    const stratText = fs.readFileSync(stratPath, "utf8");
    const factions = parseDescrStratFactions(stratText);
    writeJson(`factions_with_regions_${c.suffix}.json`, factions);

    const stratBuildings = parseDescrStratBuildings(stratText);
    writeJson(`descr_strat_buildings_${c.suffix}.json`, stratBuildings);

    writeJson(`population_${c.suffix}.json`, derivePopulation(stratBuildings));

    // TGA-dependent parsers
    let tgaBuf = null;
    if (mapPath) tgaBuf = fs.readFileSync(mapPath);

    const resources = parseDescrStratResources(stratText, c.mapHeight, tgaBuf, regions);
    writeJson(`resources_${c.suffix}.json`, resources);

    const armies = parseArmiesClassified(stratText, tgaBuf, c.mapHeight);
    writeJson(`armies_${c.suffix}.json`, armies);
  }

  log("done.");
}

try { run(); }
catch (e) {
  console.error("[bundle] FATAL:", e.stack || e.message);
  process.exit(1);
}
