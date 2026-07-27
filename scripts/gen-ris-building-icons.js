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
 *
 * TWO SIZES OF ART, both emitted:
 *   - `#<culture>_<level>.tga`             — the small square list icon  -> wiki/icons/
 *   - `#<culture>_<level>_constructed.tga` — the ~361x163 banner the game shows in the
 *                                            building detail panel      -> wiki/art/
 * The banner is the picture of the building; the icon is a thumbnail. A chain page that
 * shows only the 32px thumbnail is showing almost nothing, so both are written.
 *
 * FOUR DIRECTORIES PER CULTURE, not one. `ui/<c>/buildings` is the obvious home, but the
 * game also looks in `ui/<c>/buildings/construction`, `ui/<c>/plugins` and
 * `ui/<c>/construction` — src/iconHandlers.js searches all four because art genuinely
 * lives there (greek market is at ui/greek/construction/#greek_market.tga). Scanning only
 * `buildings` sends such a level off to another culture's art when its own is present.
 *
 * TWO CONSUMERS, so two index files:
 *   - `icons/index.json`  keyed "<culture>/<level>" — what the region pages need, because a
 *     region has a culture and shows its own art.
 *   - `art/index.json`    keyed "<level>" — what the building CHAIN pages need. A chain page
 *     is not about one culture, so it takes the best available art (Roman first, then the
 *     declared fallbacks, then any culture that ships some) and records which culture and
 *     which level name it actually came from, so the page can say so instead of implying
 *     the art is the level's own.
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
// The constructed banners are ~361x163 and mostly photographic, so PNG barely compresses
// them: 226 of them come to 32 MB at native size. Kept at 1 because a chain page shows them
// at native width — halving costs 24 MB but leaves a 180px mush. Raise --art-scale if the
// repo weight ever matters more than the picture.
const ART_SCALE = Math.max(1, parseInt(valOf("--art-scale", "1"), 10));

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
// Search order within a culture. First hit wins, so `buildings` — the canonical home —
// takes precedence over the three places the rest of the art hides in.
const SUBDIRS = ["buildings", path.join("buildings", "construction"), "plugins", "construction"];

/** `kind` is "icon" (the small square) or "constructed" (the wide banner). */
function indexIcons(dataDir, kind) {
  const root = path.join(dataDir, "ui");
  const byCulture = new Map();
  let files = 0;
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return { byCulture, files }; }
  for (const cul of dirs) {
    const m = new Map();
    for (const sub of SUBDIRS) {
      const bdir = path.join(root, cul, sub);
      let names = [];
      try { names = fs.readdirSync(bdir); } catch { continue; }
      for (const n of names) {
        // `.TGA` as well as `.tga` — #roman_collective_draw_rights_constructed.TGA is
        // spelled that way on disk, and a case-sensitive test drops it.
        if (!/\.tga$/i.test(n)) continue;
        // `#roman_agroforestry_1.tga` -> agroforestry_1 (strip the # and the culture prefix).
        // `_constructed` variants are the built-state banner; the plain one is the icon.
        let base = n.replace(/^#/, "").replace(/\.tga$/i, "").toLowerCase();
        const isCon = base.endsWith("_constructed");
        if (isCon !== (kind === "constructed")) continue;
        files++;
        if (isCon) base = base.slice(0, -"_constructed".length);
        const pfx = cul.toLowerCase() + "_";
        const level = base.startsWith(pfx) ? base.slice(pfx.length) : base;
        if (!m.has(level)) m.set(level, path.join(bdir, n));
      }
    }
    if (m.size) byCulture.set(cul.toLowerCase(), m);
  }
  return { byCulture, files };
}

/** Vanilla underneath, the mod on top: RIS art must override the base game's. */
function mergeRoots(kind) {
  const van = indexIcons(VAN, kind);
  const ris = indexIcons(RIS, kind);
  const byCulture = new Map();
  for (const [cul, m] of van.byCulture) byCulture.set(cul, new Map(m));
  for (const [cul, m] of ris.byCulture) {
    if (!byCulture.has(cul)) byCulture.set(cul, new Map());
    for (const [lvl, f] of m) byCulture.get(cul).set(lvl, f);   // mod wins
  }
  return { byCulture, files: van.files + ris.files, ris: ris.files, van: van.files };
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

/**
 * Best art for a level with no culture in mind — what a chain page needs.
 * Roman first (by far the most complete set), then Roman's declared fallbacks, then every
 * culture that ships anything, then the same again through the level aliases. Returns the
 * culture and level actually used so the caller can be honest about a substitution.
 */
function resolveGeneric(byCulture, fallbacks, aliases, level) {
  const chain = ["roman", ...(fallbacks.roman || []), ...[...byCulture.keys()].sort()];
  const levels = [level];
  if (aliases[level] && aliases[level] !== level) levels.push(aliases[level]);
  for (const lvl of levels) {
    for (const cul of chain) {
      const m = byCulture.get(cul);
      const hit = m && m.get(lvl);
      if (hit) return { file: hit, culture: cul, level: lvl };
    }
  }
  return null;
}

/** Every level named by an `levels …` line in the EDB, in first-seen order. */
function edbLevels() {
  const txt = rd("export_descr_buildings.txt") || "";
  const out = [];
  for (const raw of txt.split(/\r?\n/)) {
    const m = /^\s*levels\s+(.+)$/.exec(raw.replace(/;.*$/, ""));
    if (!m) continue;
    for (const l of m[1].trim().split(/\s+/)) {
      if (/^[a-z0-9_+]+$/i.test(l) && !out.includes(l.toLowerCase())) out.push(l.toLowerCase());
    }
  }
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────────
const factionCulture = loadFactionCultures();
const cultures = new Set(Object.values(factionCulture));
const { fallbacks, aliases } = loadLookupVariants(cultures);
const icoIdx = mergeRoots("icon");
const conIdx = mergeRoots("constructed");
const byCulture = icoIdx.byCulture;
const files = icoIdx.files;

console.log(`factions with a culture: ${Object.keys(factionCulture).length} · distinct cultures: ${cultures.size}`);
console.log(`lookup_variants: ${Object.keys(fallbacks).length} cultures with fallbacks, ${Object.keys(aliases).length} level aliases`);
console.log(`icon files: ${files.toLocaleString("en-US")} (${icoIdx.ris.toLocaleString("en-US")} from the mod, ${icoIdx.van.toLocaleString("en-US")} from vanilla) across ${byCulture.size} culture folders`);
console.log(`constructed-art files: ${conIdx.files.toLocaleString("en-US")} (${conIdx.ris.toLocaleString("en-US")} from the mod, ${conIdx.van.toLocaleString("en-US")} from vanilla) across ${conIdx.byCulture.size} culture folders`);

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
const seen = new Set();   // icon filenames attempted this run
const okIcons = new Set();   // …of those, the ones that actually decoded and were written
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
      okIcons.add(name);
      written++; bytes += r.buf.length;
    } catch { failed++; continue; }
  }
  // Only point the map at art that decoded THIS run. A file left over from a previous run
  // may be the corrupted output of an older decoder, and pointing at it would republish it.
  if (!okIcons.has(name)) continue;
  map[key] = `icons/${name}`;
}

fs.writeFileSync(path.join(OUT, "icons", "index.json"), JSON.stringify(map, null, 0), "utf8");

console.log(`\nicons written:   ${written.toLocaleString("en-US")} (${(bytes / 1048576).toFixed(1)} MB at 1/${SCALE} scale)`);
console.log(`  resolved via a culture fallback: ${viaFallback.toLocaleString("en-US")}`);
console.log(`  resolved via a level alias:      ${viaAlias.toLocaleString("en-US")}`);
console.log(`  unresolved:                      ${unresolved.toLocaleString("en-US")}${misses.length ? ` (e.g. ${misses.join(", ")})` : ""}`);
console.log(`  failed to decode:                ${failed.toLocaleString("en-US")}`);
console.log(`  map entries for the region pages: ${Object.keys(map).length.toLocaleString("en-US")}`);

// ── per-level art for the building chain pages ───────────────────────────────
// A chain page covers every level in the EDB, including the many nobody has built at turn 1,
// so the strat-derived set above does not cover it. And it is not about one culture, so it
// takes the best art available rather than one culture's.
const levels = edbLevels();
fs.mkdirSync(path.join(OUT, "art"), { recursive: true });
const artMap = {};   // level -> { icon, art, artCulture, artLevel, iconCulture, iconLevel }
let artWritten = 0, artBytes = 0, artFailed = 0, noArt = 0, artSubstituted = 0, artNonRoman = 0;
let extraIcons = 0, noIcon = 0;
const artSeen = new Set(), okArt = new Set();
const noArtLevels = [], noIconLevels = [];

for (const level of levels) {
  const rec = {};

  const ico = resolveGeneric(byCulture, fallbacks, aliases, level);
  if (ico) {
    const name = `${slug(ico.culture)}__${slug(ico.level)}.png`;
    if (!seen.has(name)) {
      seen.add(name);
      try {
        const r = convert(ico.file, SCALE);
        if (r) { fs.writeFileSync(path.join(OUT, "icons", name), r.buf); okIcons.add(name); extraIcons++; bytes += r.buf.length; }
        else failed++;
      } catch { failed++; }
    }
    if (okIcons.has(name)) {
      rec.icon = `icons/${name}`;
      rec.iconCulture = ico.culture;
      rec.iconLevel = ico.level;
    }
  } else { noIcon++; if (noIconLevels.length < 8) noIconLevels.push(level); }

  const con = resolveGeneric(conIdx.byCulture, fallbacks, aliases, level);
  if (con) {
    if (con.level !== level) artSubstituted++;
    if (con.culture !== "roman") artNonRoman++;
    const name = `${slug(con.culture)}__${slug(con.level)}.png`;
    if (!artSeen.has(name)) {
      artSeen.add(name);
      try {
        const r = convert(con.file, ART_SCALE);
        if (r) { fs.writeFileSync(path.join(OUT, "art", name), r.buf); okArt.add(name); artWritten++; artBytes += r.buf.length; }
        else artFailed++;
      } catch { artFailed++; }
    }
    if (okArt.has(name)) {
      rec.art = `art/${name}`;
      rec.artCulture = con.culture;
      rec.artLevel = con.level;
    }
  } else { noArt++; if (noArtLevels.length < 8) noArtLevels.push(level); }

  artMap[level] = rec;
}

fs.writeFileSync(path.join(OUT, "art", "index.json"), JSON.stringify(artMap, null, 0), "utf8");
// icons/index.json is rewritten because the loop above added files it can now point at:
// a level nobody has built at turn 1 still needs an icon on its chain page.
fs.writeFileSync(path.join(OUT, "icons", "index.json"), JSON.stringify(map, null, 0), "utf8");

console.log(`\nEDB levels needing chain-page art: ${levels.length.toLocaleString("en-US")}`);
console.log(`  extra icons written for them:  ${extraIcons.toLocaleString("en-US")} (levels with no icon at all: ${noIcon}${noIconLevels.length ? ` — ${noIconLevels.join(", ")}` : ""})`);
console.log(`  constructed images written:    ${artWritten.toLocaleString("en-US")} (${(artBytes / 1048576).toFixed(1)} MB at 1/${ART_SCALE} scale)`);
console.log(`    levels with a constructed image: ${(levels.length - noArt).toLocaleString("en-US")} of ${levels.length}`);
console.log(`    art from another culture:        ${artNonRoman.toLocaleString("en-US")}`);
console.log(`    art borrowed via a level alias:  ${artSubstituted.toLocaleString("en-US")}`);
console.log(`    levels with none:               ${noArt.toLocaleString("en-US")}${noArtLevels.length ? ` — ${noArtLevels.join(", ")}` : ""}`);
console.log(`    failed to decode:               ${artFailed.toLocaleString("en-US")}`);
