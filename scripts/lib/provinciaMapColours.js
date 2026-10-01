// Provincia's map-mode colours, for the wiki's world map (asked for 2026-10-01: "for the
// coloured mapmodes, use the same as in Provincia").
//
// The palettes and helpers are READ OUT OF src/App.js at run time and evaluated as written, so
// they cannot drift from the app: RELIGION_COLORS, CULTURE_PALETTE, the terrain / climate /
// port / irrigation tables, the AOR tables and the tag helpers. App.js is a React module and
// exports none of them, hence the extraction. The per-mode rules below are the colorMode
// branches of App.js's "Build colored overlay canvas" effect, line for line:
//   faction  owner's descr_sm_factions primary, else slave's; jitter 0x3F x0.6
//   culture  CULTURE_PALETTE by first appearance in descr_regions, or the first people's
//            colour where a region has several peoples; jitter 0x3F x0.9
//   aor      first zone of the primary layer (by frequency), its faction's primary or
//            CULTURE_PALETTE[stableAorColorIndex]; none [80,75,70]; jitter 0x3F x0.6
//   farm     red -> yellow -> green over Farm1..FarmN; jitter 0x1F x0.7
//   terrain, climate, port_level, irrigation, rivertrade   the dev tables; jitter 0xFF x0.25
// The jitter is App.js's per-province brightness step, from the region's map colour.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "..", "src", "App.js");
const NAMES = [
  "RELIGION_COLORS", "TERRAIN_COLORS", "CLIMATE_COLORS", "PORT_COLORS", "IRRIGATION_COLORS",
  "TERRAIN_TAGS", "CLIMATE_TAGS", "IRRIGATION_TAGS", "getTagValue", "getPortLevel", "hasTag", "getAors",
  "PRIMARY_AOR_TO_FACTION", "PRIMARY_AOR_TAGS", "SPECIALTY_AOR_BARE", "LEGION_AORS", "LEGION_AOR_TAGS",
  "stableAorColorIndex", "SECONDARY_AOR_TO_FACTION", "AOR_OVERRIDES", "splitAorsByLayer",
  "parseEthnicities", "getEthnicityColor", "CULTURE_PALETTE",
];

// The source of one top-level `const NAME = …;` or `function NAME(…) {…}`, found by scanning
// brackets while skipping strings, template literals and comments.
function extract(src, name) {
  const m = new RegExp(`^(const|function)\\s+${name}\\b`, "m").exec(src);
  if (!m) throw new Error(`provinciaMapColours: ${name} not found in App.js`);
  let i = m.index, depth = 0, seenBody = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") { depth++; seenBody = true; }
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (m[1] === "function" && depth === 0 && c === "}") return src.slice(m.index, i + 1);
    } else if (c === ";" && depth === 0 && m[1] === "const") return src.slice(m.index, i + 1);
    else if (c === "\n" && depth === 0 && seenBody && m[1] === "const" && /^\S/.test(src.slice(i + 1, i + 2))) return src.slice(m.index, i);
  }
  throw new Error(`provinciaMapColours: could not read ${name}`);
}

let LIB = null;
function lib() {
  if (LIB) return LIB;
  const src = fs.readFileSync(APP, "utf8");
  const code = NAMES.map((n) => extract(src, n)).join("\n") + `\n({ ${NAMES.join(", ")} })`;
  LIB = vm.runInNewContext(code, { Set, Map, Object, Math, String, parseInt, isNaN, Array });
  return LIB;
}

const clamp = (v) => Math.max(0, Math.min(255, v));
const jitter = (base, rgb, mask, half, k) => {
  const v = (((rgb[0] * 31 + rgb[1] * 17 + rgb[2] * 7) & mask) - half) * k;
  return [clamp(base[0] + v), clamp(base[1] + v), clamp(base[2] + v)].map(Math.round);
};

/**
 * Colour every region for each Provincia mode.
 *   regions   parsers.parseDescrRegions() of the campaign's descr_regions.txt: "r,g,b" -> record
 *   owners    region name -> owning faction token at the campaign start
 *   sm        parsers.parseSmFactions() of descr_sm_factions.txt
 * Returns { colourOf(mode, rgbKey) -> [r,g,b] | null, baseOf(mode, rgbKey) -> unjittered colour }.
 */
function build(regions, owners, sm) {
  const L = lib();
  const fc = (f) => (f && sm[String(f).toLowerCase()] && sm[String(f).toLowerCase()].primary) || null;
  const entries = Object.entries(regions);

  const cultureColors = {};
  let ci = 0;
  for (const [, v] of entries) {
    if (v.culture && !cultureColors[v.culture]) { cultureColors[v.culture] = L.CULTURE_PALETTE[ci % L.CULTURE_PALETTE.length]; ci++; }
  }
  const getFarm = (r) => { const m = String(r.tags || "").match(/\bFarm(\d+)\b/); return m ? parseInt(m[1], 10) : 0; };
  const maxFarm = Math.max(1, ...entries.map(([, r]) => getFarm(r)));

  const aorFreq = {};
  for (const [, r] of entries) for (const a of L.getAors(r.tags)) aorFreq[a] = (aorFreq[a] || 0) + 1;
  const aorFirst = {};
  const aorColors = {};
  for (const [key, r] of entries) {
    const { primary, secondary } = L.splitAorsByLayer(r.tags, r.city);
    if (!primary.length && !secondary.length) continue;
    const byFreq = (a, b) => { const da = aorFreq[a] || 0, db = aorFreq[b] || 0; return da !== db ? db - da : a.localeCompare(b); };
    const ordered = [...primary.slice().sort(byFreq), ...secondary.slice().sort(byFreq)];
    aorFirst[key] = ordered[0];
    for (const a of ordered) {
      if (aorColors[a]) continue;
      const facId = L.PRIMARY_AOR_TO_FACTION[a] || L.SECONDARY_AOR_TO_FACTION[a];
      aorColors[a] = fc(facId) || L.CULTURE_PALETTE[L.stableAorColorIndex(a, L.CULTURE_PALETTE.length)];
    }
  }

  const baseOf = (mode, key) => {
    const r = regions[key];
    if (!r) return null;
    switch (mode) {
      case "faction": return fc(owners[r.region]) || fc("slave") || fc("rebels") || key.split(",").map(Number);
      case "culture": {
        const eth = L.parseEthnicities(r.ethnicities);
        return eth.length > 1 ? L.getEthnicityColor(eth[0].name) : (cultureColors[r.culture] || [128, 128, 128]);
      }
      case "people": {
        const eth = L.parseEthnicities(r.ethnicities);
        return eth.length ? L.getEthnicityColor(eth[0].name) : null;
      }
      case "zones": return aorFirst[key] ? aorColors[aorFirst[key]] : [80, 75, 70];
      case "fertility": {
        const t = Math.min(1, getFarm(r) / maxFarm);
        return [t < 0.5 ? 210 : Math.round(210 - (t - 0.5) * 2 * 160), t < 0.5 ? Math.round(t * 2 * 200) : 200, 30];
      }
      case "terrain": { const t = L.getTagValue(r.tags, L.TERRAIN_TAGS); return (t && L.TERRAIN_COLORS[t]) || [100, 100, 100]; }
      case "climate": { const c = L.getTagValue(r.tags, L.CLIMATE_TAGS); return (c && L.CLIMATE_COLORS[c]) || [100, 100, 100]; }
      case "port": {
        const lvl = L.getPortLevel(r.tags), isTI = r.region === "Terra_Incognita";
        if (lvl != null && lvl > 0) return L.PORT_COLORS[lvl] || L.PORT_COLORS.inland;
        if (lvl === 0 && !isTI) return L.PORT_COLORS[0];
        return L.PORT_COLORS.inland;
      }
      case "water": { const irr = L.getTagValue(r.tags, L.IRRIGATION_TAGS); return irr ? L.IRRIGATION_COLORS[irr] : L.IRRIGATION_COLORS.none; }
      case "river": return L.hasTag(r.tags, "rivertrade") ? [50, 170, 70] : [160, 130, 100];
      default: return null;
    }
  };
  const JITTER = {
    faction: [0x3F, 32, 0.6], culture: [0x3F, 32, 0.9], people: [0x3F, 32, 0.9], zones: [0x3F, 32, 0.6],
    fertility: [0x1F, 16, 0.7],
    terrain: [0xFF, 128, 0.25], climate: [0xFF, 128, 0.25], port: [0xFF, 128, 0.25], water: [0xFF, 128, 0.25], river: [0xFF, 128, 0.25],
  };
  const colourOf = (mode, key) => {
    const b = baseOf(mode, key);
    if (!b || !JITTER[mode]) return b;
    return jitter(b, key.split(",").map(Number), ...JITTER[mode]);
  };
  return { colourOf, baseOf, modes: Object.keys(JITTER), lib: L };
}

module.exports = { build, lib };
