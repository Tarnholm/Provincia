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
let parseDescrRegions, parseDescrStratFactions, parseDescrStratBuildings, parseDescrStratResources, parseDescrStratFactionWealth;
async function loadParsers() {
  const mod = await import("../src/parsers.js");
  parseDescrRegions = mod.parseDescrRegions;
  parseDescrStratFactions = mod.parseDescrStratFactions;
  parseDescrStratBuildings = mod.parseDescrStratBuildings;
  parseDescrStratResources = mod.parseDescrStratResources;
  parseDescrStratFactionWealth = mod.parseDescrStratFactionWealth;
}

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

// ── Per-region starting armies builder ──────────────────────────────────
// Mirrors the dev-import classification at App.js's import flow: walks the
// TGA pixel grid to find each region's settlement tile (a (0,0,0) pixel
// adjacent to a region-coloured pixel), then buckets armies into
// garrison/field per region. Synthetic garrisoned_army entries (no x/y) are
// snapped to their settlement tile via the captured `region` field.
function buildStartingArmiesByRegion(armies, tgaBuf, regionsMap) {
  const idLen = tgaBuf[0];
  const w = tgaBuf[12] | (tgaBuf[13] << 8);
  const h = tgaBuf[14] | (tgaBuf[15] << 8);
  const bpp = tgaBuf[16];
  const stride = bpp / 8;
  const dataOff = 18 + idLen;
  const descriptor = tgaBuf[17];
  const topDown = (descriptor & 0x20) !== 0;
  const bufRow = (stratY) => topDown ? (h - 1 - stratY) : stratY;

  const rgbToRegion = {};
  for (const [rgb, r] of Object.entries(regionsMap)) {
    if (r.region) rgbToRegion[rgb] = r.region;
  }

  // Find each region's settlement tile (black pixel with a region-coloured neighbour).
  const settlementByRegion = {};
  for (let by = 0; by < h; by++) {
    for (let x = 0; x < w; x++) {
      const i = dataOff + (by * w + x) * stride;
      if (tgaBuf[i] !== 0 || tgaBuf[i + 1] !== 0 || tgaBuf[i + 2] !== 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = by + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const j = dataOff + (ny * w + nx) * stride;
        const key = tgaBuf[j + 2] + "," + tgaBuf[j + 1] + "," + tgaBuf[j];
        const reg = rgbToRegion[key];
        if (reg) {
          const stratY = topDown ? (h - 1 - by) : by;
          if (!settlementByRegion[reg]) settlementByRegion[reg] = { x, y: stratY };
          break;
        }
      }
    }
  }

  const tileKeyToRegion = {};
  for (const [reg, p] of Object.entries(settlementByRegion)) {
    tileKeyToRegion[`${p.x},${p.y}`] = reg;
  }
  const pixelRgb = (sx, sy) => {
    const by = bufRow(sy);
    if (sx < 0 || sx >= w || by < 0 || by >= h) return null;
    const idx = dataOff + (by * w + sx) * stride;
    return tgaBuf[idx + 2] + "," + tgaBuf[idx + 1] + "," + tgaBuf[idx];
  };

  const byRegion = {};
  for (const [reg, p] of Object.entries(settlementByRegion)) {
    byRegion[reg] = { garrison: [], field: [], settlement: p };
  }

  // Helper: normalise unit list into [{name, exp, armour, weapon}].
  const normUnits = (units) => (units || []).map(u =>
    typeof u === "string"
      ? { name: u, exp: 0, armour: 0, weapon: 0 }
      : { name: u.name, exp: u.exp || 0, armour: u.armour || 0, weapon: u.weapon || 0 }
  );
  for (const a of armies) {
    // Synthetic garrisoned_army: pin to its declared region's settlement tile.
    if (a._garrisoned && a.region) {
      const tile = settlementByRegion[a.region];
      if (!byRegion[a.region]) byRegion[a.region] = { garrison: [], field: [], settlement: tile || null };
      byRegion[a.region].garrison.push({
        character: a.name, faction: a.faction,
        x: tile?.x ?? null, y: tile?.y ?? null,
        units: normUnits(a.units),
      });
      continue;
    }
    if (a.x == null || a.y == null) continue;
    let region = tileKeyToRegion[`${a.x},${a.y}`];
    let isGarrison = !!region;
    if (!region) {
      const rgb = pixelRgb(a.x, a.y);
      region = rgb && rgbToRegion[rgb];
    }
    if (!region) continue;
    if (!byRegion[region]) byRegion[region] = { garrison: [], field: [], settlement: settlementByRegion[region] || null };
    byRegion[region][isGarrison ? "garrison" : "field"].push({
      character: a.name, faction: a.faction,
      x: a.x, y: a.y,
      units: normUnits(a.units),
    });
  }
  return byRegion;
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
  // Settlement state: when we're inside `settlement { ... }` we track its
  // region name so a `garrisoned_army` block (which has no character/coord
  // line of its own) can attach its units to that region's settlement tile.
  let inSettlement = false, settlementRegion = null, settlementBraceDepth = 0;
  let inGarrisonedArmy = false, currentGarrison = null;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const s = rawLine.replace(/\s+$/, "");
    const t = s.trim();
    const fm = /^faction\s+(\w+)/.exec(s);
    if (fm) {
      if (current && current.units.length) armies.push(current);
      faction = fm[1]; current = null; inArmy = false; prevComment = "";
      inSettlement = false; settlementRegion = null; settlementBraceDepth = 0;
      inGarrisonedArmy = false; currentGarrison = null;
      continue;
    }
    if (t.startsWith(";") && !/^character,/.test(s)) prevComment = t;
    // Track settlement blocks so we can attach garrisoned_army to the right region.
    if (t === "settlement") { inSettlement = true; settlementRegion = null; settlementBraceDepth = 0; continue; }
    if (inSettlement) {
      // Track brace depth — a settlement block ends at depth 0 after closing `}`.
      if (t === "{") { settlementBraceDepth++; continue; }
      if (t === "}") {
        settlementBraceDepth--;
        if (settlementBraceDepth <= 0) {
          // End of settlement block. Flush garrisoned_army if open.
          if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
          inSettlement = false; settlementRegion = null; settlementBraceDepth = 0;
          inGarrisonedArmy = false; currentGarrison = null;
        }
        continue;
      }
      const rm = /^region\s+(\S+)/.exec(t);
      if (rm) { settlementRegion = rm[1]; continue; }
      // Start of a garrisoned_army block. RIS uses bare `unit` lines after
      // this header (no separate `army` keyword, and no character block —
      // just sub-faction-tagged loose units that the game places on the
      // settlement tile).
      if (t === "garrisoned_army") {
        // Flush any previous garrison army still open (defensive).
        if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
        currentGarrison = {
          name: settlementRegion ? `Garrison of ${settlementRegion}` : "Garrison",
          charType: "garrison",
          armyClass: "garrison",
          location: settlementRegion || "",
          faction,
          // x/y resolved at consumption time from settlementByRegion lookup —
          // garrisoned_army has no explicit coords. Leave null so the
          // renderer's classifier knows to snap to the settlement tile.
          x: null, y: null,
          region: settlementRegion || null,
          units: [],
          _garrisoned: true, // synthetic source flag for downstream
        };
        inGarrisonedArmy = true;
        continue;
      }
      if (inGarrisonedArmy) {
        const um = UNIT_RE.exec(t);
        if (um) {
          // Capture exp / armour / weapon_lvl from the same line.
          const exp = (t.match(/\bexp\s+(\d+)/) || [, "0"])[1] | 0;
          const armour = (t.match(/\barmour\s+(\d+)/) || [, "0"])[1] | 0;
          const weapon = (t.match(/\bweapon_lvl\s+(\d+)/) || [, "0"])[1] | 0;
          currentGarrison.units.push({ name: um[1].trim(), exp, armour, weapon });
          continue;
        }
        // Anything other than a `unit ...` line ends the garrisoned_army block.
        if (t === "building" || t.startsWith("building") || t === "{" || t === "}" ||
            /^[a-z_]+\s/.test(t)) {
          if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
          currentGarrison = null;
          inGarrisonedArmy = false;
          // Fall through so we don't lose the line — but we don't need to
          // process it specifically here.
        }
      }
    }
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
        // descr_strat y is bottom-up (y=0 at bottom). Keep that convention
        // so the bundled JSON matches the dev-import / live-save data —
        // the renderer flips once for all of them.
        y: snapY,
        units: [],
      };
      prevComment = "";
      continue;
    }
    if (t === "army") { inArmy = true; continue; }
    if (inArmy && current) {
      const um = UNIT_RE.exec(t);
      if (um) {
        const exp = (t.match(/\bexp\s+(\d+)/) || [, "0"])[1] | 0;
        const armour = (t.match(/\barmour\s+(\d+)/) || [, "0"])[1] | 0;
        const weapon = (t.match(/\bweapon_lvl\s+(\d+)/) || [, "0"])[1] | 0;
        current.units.push({ name: um[1].trim(), exp, armour, weapon });
      }
      else if (t && !/^\s/.test(s) && s[0] !== "\t") inArmy = false;
    }
  }
  if (current && current.units.length) armies.push(current);
  if (currentGarrison && currentGarrison.units.length) armies.push(currentGarrison);
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

    const wealth = parseDescrStratFactionWealth(stratText);
    writeJson(`faction_wealth_${c.suffix}.json`, wealth);

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

    // Build starting_armies_<suffix>.json: { region: { settlement: {x,y},
    // garrison: [armies], field: [armies] } }. Mirrors the per-region
    // classification the dev-import flow produces. Without this, slave
    // settlements (and any other settlement using `garrisoned_army` rather
    // than character-based armies) show empty in the region info panel.
    if (tgaBuf) {
      const startingByRegion = buildStartingArmiesByRegion(armies, tgaBuf, regions);
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
