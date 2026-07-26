#!/usr/bin/env node
/**
 * Convert RIS building icons from TGA to PNG for the wiki.
 *
 *   node scripts/gen-ris-building-icons.js [--ris <dir>] [--out <dir>] [--scale N]
 *
 * Icons live at `ui/<culture>/buildings/#<culture>_<level>.tga`, so resolving one needs
 * the CULTURE as well as the level name — which is why this is more than a filename
 * lookup. The game states the rules in `descr_ui_buildings.txt`:
 *
 *   - CULTURE FALLBACKS: `<culture_lacking_art> <fallback>`, several lines per culture
 *     giving preference order. So a level with no anatolian art falls back to greek, then
 *     roman, and so on.
 *   - LEVEL ALIASES: `<mod_level> <vanilla_level>` e.g. `royal_mint scriptorium` — use the
 *     vanilla icon for a level the mod invented.
 *
 * Both kinds sit in one `lookup_variants` block as bare space-separated pairs, told apart
 * by whether the left token is a known culture.
 *
 * NOT REUSING PROVINCIA'S RESOLVER, deliberately. `resolveBuildingIconCore` in
 * src/iconHandlers.js does all of this already, but it is declared inside
 * `registerIconHandlers` and closes over injected dependencies including Electron's
 * `nativeImage`. Lifting it out is a refactor of the app's icon load path; reimplementing
 * the lookup here touches nothing that ships to users.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
// Vanilla is a SECOND icon root. RIS only ships art it changed, so common levels
// (shipwright, shrine, port, governors_villa …) have no icon in the mod at all and must
// come from the base game — 164 pairs were unresolved until this was added.
const VAN = valOf("--vanilla",
  "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const SCALE = Math.max(1, parseInt(valOf("--scale", "1"), 10));

const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ── PNG writer (same as the unit-card generator; no image library) ────────────
// PNG encoding and TGA decoding live in scripts/lib/tgaPng.js — shared with the other
// wiki image generator. They were duplicated here, and both copies carried the same
// 32bpp-source bug that made every icon and card render as colour stripes.
const { png, convert: convertTga } = require(path.join(__dirname, "lib", "tgaPng.js"));
const convert = (file, scale) => convertTga(dg, file, scale);

// ── faction -> culture ───────────────────────────────────────────────────────
// descr_sm_factions.txt is JSON-like: `"romans_julii": { … "culture": "roman", … }`.
function loadFactionCultures() {
  const txt = rd("descr_sm_factions.txt") || "";
  const out = {};
  // Walk line by line, remembering the most recent faction key, because the culture line
  // sits several lines below it.
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "");
    let m = /^\s*"([a-z0-9_]+)"\s*:\s*$/.exec(line);
    if (m && m[1] !== "factions") { cur = m[1].toLowerCase(); continue; }
    m = /"culture"\s*:\s*"([a-z_]+)"/.exec(line);
    if (m && cur) { out[cur] = m[1].toLowerCase(); cur = null; }
  }
  return out;
}

// ── descr_ui_buildings: culture fallbacks + level aliases ────────────────────
function loadLookupVariants(cultures) {
  const txt = rd("descr_ui_buildings.txt") || "";
  const block = /lookup_variants\s*\{([\s\S]*?)\n\s*\}/.exec(txt);
  const fallbacks = {};   // culture -> [preferred, …]
  const aliases = {};     // mod level -> vanilla level
  if (!block) return { fallbacks, aliases };
  for (const raw of block[1].split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 2) continue;
    const [a, b] = parts.map((x) => x.toLowerCase());
    // Told apart by whether the left token names a culture. Getting this backwards would
    // put level names into the fallback chains and cultures into the alias table.
    if (cultures.has(a)) { (fallbacks[a] = fallbacks[a] || []).push(b); }
    else { aliases[a] = b; }
  }
  return { fallbacks, aliases };
}

// ── icon index: culture -> level -> file ─────────────────────────────────────
function indexIcons(dataDir) {
  const root = path.join(dataDir, "ui");
  const byCulture = new Map();
  let files = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return { byCulture, files }; }
  for (const cul of dirs) {
    const bdir = path.join(root, cul, "buildings");
    let names = [];
    try { names = fs.readdirSync(bdir); } catch { continue; }
    const m = new Map();
    for (const n of names) {
      if (!/\.tga$/i.test(n)) continue;
      files++;
      // `#roman_agroforestry_1.tga` -> agroforestry_1 (strip the # and the culture prefix).
      // `_constructed` variants are the built-state art; the plain one is the icon.
      let base = n.replace(/^#/, "").replace(/\.tga$/i, "").toLowerCase();
      if (base.endsWith("_constructed")) continue;
      const pfx = cul.toLowerCase() + "_";
      const level = base.startsWith(pfx) ? base.slice(pfx.length) : base;
      if (!m.has(level)) m.set(level, path.join(bdir, n));
    }
    if (m.size) byCulture.set(cul.toLowerCase(), m);
  }
  return { byCulture, files };
}

/** Resolve level -> file for a culture, following aliases then the fallback chain. */
function resolveIcon(byCulture, fallbacks, aliases, culture, level) {
  const tryCulture = (cul, lvl) => {
    const m = byCulture.get(cul);
    return m ? m.get(lvl) || null : null;
  };
  const levels = [level];
  if (aliases[level] && aliases[level] !== level) levels.push(aliases[level]);
  const chain = [culture, ...(fallbacks[culture] || [])];
  for (const lvl of levels) {
    for (const cul of chain) {
      const hit = tryCulture(cul, lvl);
      if (hit) return { file: hit, culture: cul, level: lvl };
    }
  }
  return null;
}

// ── run ──────────────────────────────────────────────────────────────────────
const factionCulture = loadFactionCultures();
const cultures = new Set(Object.values(factionCulture));
const { fallbacks, aliases } = loadLookupVariants(cultures);
// Vanilla first, then RIS on top: the mod's own art must override the base game's.
const vanIdx = indexIcons(VAN);
const risIdx = indexIcons(RIS);
const byCulture = new Map();
for (const [cul, m] of vanIdx.byCulture) byCulture.set(cul, new Map(m));
for (const [cul, m] of risIdx.byCulture) {
  if (!byCulture.has(cul)) byCulture.set(cul, new Map());
  for (const [lvl, f] of m) byCulture.get(cul).set(lvl, f);   // mod wins
}
const files = vanIdx.files + risIdx.files;

console.log(`factions with a culture: ${Object.keys(factionCulture).length} · distinct cultures: ${cultures.size}`);
console.log(`lookup_variants: ${Object.keys(fallbacks).length} cultures with fallbacks, ${Object.keys(aliases).length} level aliases`);
console.log(`icon files: ${files.toLocaleString("en-US")} (${risIdx.files.toLocaleString("en-US")} from the mod, ${vanIdx.files.toLocaleString("en-US")} from vanilla) across ${byCulture.size} culture folders`);

// Every (culture, level) pair the wiki actually needs, from what regions have built.
const strat = gv.parseStrat(path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt")) || {};
const needed = new Map();   // `${culture}/${level}` -> {culture, level}
for (const [fac, v] of Object.entries(strat)) {
  const cul = factionCulture[fac.toLowerCase()];
  if (!cul) continue;
  for (const s of (v.settlements || [])) {
    for (const b of (s.buildings || [])) {
      const k = `${cul}/${b.level.toLowerCase()}`;
      if (!needed.has(k)) needed.set(k, { culture: cul, level: b.level.toLowerCase() });
    }
  }
}
console.log(`(culture, level) pairs the regions need: ${needed.size.toLocaleString("en-US")}`);

fs.mkdirSync(path.join(OUT, "icons"), { recursive: true });
let written = 0, bytes = 0, unresolved = 0, failed = 0, viaFallback = 0, viaAlias = 0;
const misses = [];
const seen = new Set();   // icon filenames written this run
const map = {};   // "culture/level" -> icons/<file>.png, for the region generator

for (const [key, { culture, level }] of needed) {
  const hit = resolveIcon(byCulture, fallbacks, aliases, culture, level);
  if (!hit) { unresolved++; if (misses.length < 8) misses.push(key); continue; }
  if (hit.culture !== culture) viaFallback++;
  if (hit.level !== level) viaAlias++;
  // Named by the art actually used, so identical art is written once and shared. The
  // "write it once" check is against names seen THIS run, not against the disk: keying off
  // fs.existsSync meant a stale file was never replaced, so when the TGA decoder was fixed
  // this generator reported "0 written" and left every broken icon in place.
  const name = `${slug(hit.culture)}__${slug(hit.level)}.png`;
  const dest = path.join(OUT, "icons", name);
  if (!seen.has(name)) {
    seen.add(name);
    try {
      const r = convert(hit.file, SCALE);
      if (!r) { failed++; continue; }
      fs.writeFileSync(dest, r.buf);
      written++; bytes += r.buf.length;
    } catch { failed++; continue; }
  }
  map[key] = `icons/${name}`;
}

fs.writeFileSync(path.join(OUT, "icons", "index.json"), JSON.stringify(map, null, 0), "utf8");

console.log(`\nicons written:   ${written.toLocaleString("en-US")} (${(bytes / 1048576).toFixed(1)} MB at 1/${SCALE} scale)`);
console.log(`  resolved via a culture fallback: ${viaFallback.toLocaleString("en-US")}`);
console.log(`  resolved via a level alias:      ${viaAlias.toLocaleString("en-US")}`);
console.log(`  unresolved:                      ${unresolved.toLocaleString("en-US")}${misses.length ? ` (e.g. ${misses.join(", ")})` : ""}`);
console.log(`  failed to decode:                ${failed.toLocaleString("en-US")}`);
console.log(`  map entries for the region pages: ${Object.keys(map).length.toLocaleString("en-US")}`);
