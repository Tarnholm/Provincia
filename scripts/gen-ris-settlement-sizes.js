#!/usr/bin/env node
/**
 * One reference page per SETTLEMENT SIZE, plus the index that lists them all.
 *
 *   node scripts/gen-ris-settlement-sizes.js [--ris <dir>] [--out <dir>]
 *
 * Run it BEFORE gen-ris-region-pages.js — that generator reads sizes/index.json to link the
 * Size value on all 1,311 settlement pages, exactly as it reads tags/index.json for the region
 * tags. Run it AFTER gen-ris-building-icons.js and gen-ris-unit-cards.js if you want the art on
 * these pages; both are optional and their absence only costs pictures, never facts.
 *
 * A settlement page says `Size: large town` and that was a dead end, the same dead end the
 * region tags had before tags/ existed. These pages answer what a size actually DECIDES.
 *
 * WHERE EACH ANSWER COMES FROM, because three different files each own part of it and none of
 * them owns all of it:
 *
 *   1. THE LADDER — descr_sm_settlements.txt, via the shared settlementRanks() the region
 *      generator already uses. Eight cultures declare a ladder there and they agree on the
 *      order. Cross-checked against descr_cultures.txt, which declares the same six names for
 *      22 cultures; both counts are printed and both have to agree before a page is written.
 *
 *   2. THE POPULATION NUMBERS — descr_cultures.txt, in each culture's `settlement upgrade
 *      levels` block. This is the file the game reads and it is the ONLY place in the mod that
 *      states a population figure for a size. There is no descr_settlement_mechanics.txt in
 *      RIS — that was the first place looked and it does not exist — so the claim is made
 *      against descr_cultures or not at all.
 *
 *      The block gives five numbers per size, and the wording is the file's own comments:
 *      `upgrade` is "population needed to upgrade to this level", `min pop` "minimum population
 *      possible in this settlement", `max pop` "maximum population before overcrowding",
 *      `squalour pop` the point above which each further head counts double for squalour, and
 *      `base` the settlement's base population before squalor applies. What is NOT stated
 *      anywhere is what makes a settlement DROP a rung, so the pages say that is not determined
 *      rather than reading a demotion rule into the upgrade threshold.
 *
 *   3. WHAT A SIZE UNLOCKS — export_descr_buildings.txt, and here the mod does not do what the
 *      RTW documentation describes. There is no `settlement_min_level` and no
 *      `settlement_max_level` anywhere in the file: counted, zero occurrences of either.
 *      What exists is `settlement_min <size>`, 273 times, and it is not a condition at all —
 *      it is a FIELD of a building level, sitting beside `construction`, `cost` and `upgrades`.
 *      Every one of the 273 level blocks in the mod carries exactly one.
 *
 *      Two things follow, and both are stated on the pages rather than glossed:
 *        - A size cannot be NEGATED, so nothing in the mod is blocked by a settlement being
 *          large. The "what it blocks" section is empty for every size, and says so with the
 *          number of clauses examined, because a silently empty section looks like a parsing
 *          failure.
 *        - Units are reached one hop away. A unit is recruited at a building level, and that
 *          level carries the minimum. So a unit's own minimum size is the smallest minimum
 *          across every level that lists a `recruit` line for it — 29,894 lines collapsing to
 *          1,135 distinct unit types.
 *
 * THE PARSER BUG THIS FOUND. The `settlement_min` lines were counted two ways — through the
 * shared parser and by a flat pattern over the file text — and the answers were 272 and 273.
 * The one in the gap was `grain-1`, the only building level in the mod whose name contains a
 * hyphen, which the shared parser's level-name pattern excluded; its block's lines were being
 * attributed to the level above it. Fixed in lib/edbRecruit.js. The two counts are still taken
 * both ways on every run and printed side by side, because that is what caught it.
 *
 * DISPLAY NAMES are the mod's own, never humanised from the token: text/shared.txt (UTF-16LE)
 * localises `{ST_LARGE_TOWN}` as "Large town" and that is what the pages print. Any size with
 * no entry there prints its token instead.
 *
 * THE ART. descr_sm_settlements and descr_cultures both declare a card image per culture per
 * size — 44 and 132 paths respectively. Almost none of them are files: RIS overrides only the
 * nomad set, and the rest live in the base game's packed data, which this repository does not
 * read. So the pages show the art that EXISTS, name the culture that declares it, and say what
 * the others resolve to. The counts are printed on every run so "the mod ships no art for this
 * size" stays a measured statement.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
// Matches both GitHub's heading-anchor rule and the local viewer's slugId(). The pair has to
// agree or every in-page link breaks in exactly one of the two places.
const anchor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = (n) => Number(n).toLocaleString("en-US");
const uniq = (a) => [...new Set(a)];
// The opening tag and the <summary> go on SEPARATE lines. Written as one line the local viewer
// does not see a block and prints the contents as literal text — that has already happened to
// 60 region pages once.
const fold = (summary, lines) => `<details>\n<summary>${summary}</summary>\n\n${lines.join("\n")}\n\n</details>`;

const L = require(path.join(__dirname, "lib", "edbRecruit.js"));
const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));
const { convert: convertTga } = require(path.join(__dirname, "lib", "tgaPng.js"));

const EDB_TXT = rd("export_descr_buildings.txt");
if (!EDB_TXT) { console.error("export_descr_buildings.txt not found"); process.exit(2); }
const ALIASES = L.parseAliases(EDB_TXT);
const EDB = L.parseEdb(EDB_TXT);

// ── display names ────────────────────────────────────────────────────────────
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return map;
}
const SHARED = loadText("shared.txt");
const BUILDING_NAMES = loadText("export_buildings.txt");
const UNIT_TEXT = loadText("export_units.txt");
const BI_NAMES = loadText("expanded_bi.txt");
const FACTION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "campaign_descriptions.txt"), "utf16le");
    for (const m of t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_TITLE\}([^\r\n]*)/g)) out[m[1].toLowerCase()] = m[2].trim();
  } catch { /* tokens */ }
  return out;
})();
const PLACE_NAMES = loadText("imperial_campaign_regions_and_settlement_names.txt");

// The size's own display name, from the file the game reads. `{ST_LARGE_TOWN}` -> "Large town".
// Never humanised: the point of the rule is that if the mod renames a rung the pages follow.
const sizeNameVia = { declared: new Set(), fallback: new Set() };
const sizeName = (tok) => {
  const hit = SHARED[`st_${String(tok).toLowerCase()}`];
  if (hit) { sizeNameVia.declared.add(tok); return hit; }
  sizeNameVia.fallback.add(tok);
  return String(tok);
};

// Same exclusion set as gen-ris-faction-pages.js and gen-ris-region-pages.js: linking a faction
// with no page was 1,006 broken links once already.
const NO_PAGE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
const npName = (f) => BI_NAMES[String(f).toLowerCase()] || String(f).replace(/_/g, " ");
const facName = (f) => FACTION_NAMES[String(f).toLowerCase()] || npName(f);
const facLink = (f) => (NO_PAGE.has(String(f).toLowerCase())
  ? `[${npName(f)}](../factions/non-playable.md)`
  : `[${facName(f)}](../factions/${f}.md)`);

const dirNames = (sub) => {
  try { return new Set(fs.readdirSync(path.join(OUT, sub)).filter((f) => /\.(md|png)$/.test(f)).map((f) => f.replace(/\.(md|png)$/, ""))); }
  catch { return new Set(); }
};
const buildingPages = dirNames("buildings");
const unitPages = dirNames("units");
const settlementPages = dirNames("settlements");
const cardFiles = dirNames("cards");
const factionPages = dirNames("factions");

let ICONS = {};
try { ICONS = JSON.parse(fs.readFileSync(path.join(OUT, "icons", "index.json"), "utf8")); } catch { /* no icons yet */ }
// A building level's icon is declared per CULTURE, and a size page is not about a culture, so
// one has to be chosen. Roman first because it is the most complete set, then whatever exists.
// Counted below, so "no icon" is a number rather than an impression.
const ICON_CULTURES = ["roman", "greek", "eastern", "barbarian", "carthaginian", "egyptian"];
const iconFor = (level) => {
  const lv = String(level).toLowerCase();
  for (const c of ICON_CULTURES) if (ICONS[`${c}/${lv}`]) return ICONS[`${c}/${lv}`];
  for (const k of Object.keys(ICONS)) if (k.endsWith(`/${lv}`)) return ICONS[k];
  return null;
};

// EDU `type` -> `dictionary`, the hop that gives both the display name and the page filename.
const TYPE_TO_DICT = (() => {
  const out = {};
  let type = null;
  for (const raw of (rd("export_descr_unit.txt") || "").split(L.SPLIT_EOL)) {
    const t = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(t);
    if (m) { type = m[1].trim().toLowerCase(); continue; }
    m = /^dictionary\s+(\S+)/.exec(t);
    if (m && type) { out[type] = m[1].toLowerCase(); type = null; }
  }
  return out;
})();
let unitNameMisses = 0, levelNameMisses = 0;
const unitName = (type) => {
  const d = TYPE_TO_DICT[String(type).toLowerCase()];
  const n = d ? UNIT_TEXT[d] : null;
  if (!n) unitNameMisses++;
  return n || String(type).replace(/\b\w/g, (c) => c.toUpperCase());
};
const unitLink = (type) => {
  const d = TYPE_TO_DICT[String(type).toLowerCase()];
  const p = d ? slug(d) : null;
  const label = `**${unitName(type)}**`;
  return p && unitPages.has(p) ? `[${label}](../units/${p}.md)` : label;
};
const CARD_W = 41, CARD_H = 56;
const unitCard = (type) => {
  const d = TYPE_TO_DICT[String(type).toLowerCase()];
  const s = d ? slug(d) : null;
  return s && cardFiles.has(s) ? `<img src="../cards/${s}.png" alt="" width="${CARD_W}" height="${CARD_H}">` : "";
};
const levelName = (level) => {
  const n = BUILDING_NAMES[String(level).toLowerCase()];
  if (!n) levelNameMisses++;
  return n || String(level).replace(/_/g, " ");
};
const chainLink = (chain) => {
  const p = String(chain).toLowerCase();
  const label = String(chain).replace(/_/g, " ");
  return buildingPages.has(p) ? `[${label}](../buildings/${p}.md)` : label;
};
const levelLink = (chain, level) => {
  const p = String(chain).toLowerCase();
  const label = `**${levelName(level)}**`;
  return buildingPages.has(p) ? `[${label}](../buildings/${p}.md)` : label;
};

// ── 1. the ladder, derived twice ─────────────────────────────────────────────
const SETTLE = L.settlementRanks(rd("descr_sm_settlements.txt") || "");

/**
 * descr_cultures.txt, the file the game reads for a culture's settlement mechanics.
 *
 * Block shape: `"cultures": [` then one block per culture at a single tab of indent, each
 * containing `"max settlement level"`, an `"unrest factors"` block, a `"settlement upgrade
 * levels"` block of one sub-block per size, and a `"settlement icons"` map. Keys can contain
 * SPACES (`"settlement upgrade levels"`, `"min pop"`), which is the detail that has to be in
 * the pattern — a `[a-z0-9_]+` class silently matches nothing and every culture comes back
 * with an empty ladder rather than an error.
 */
function loadCultures(txt) {
  const out = [];
  let cur = null, section = null, lvl = null;
  for (const raw of String(txt || "").split(L.SPLIT_EOL)) {
    const line = raw.replace(/;.*$/, "");
    const t = line.trim();
    if (!t) continue;
    let m = /^"([a-z0-9_ ]+)"\s*:\s*$/.exec(t);
    if (m) {
      const tok = m[1];
      if (tok === "cultures") continue;
      if (/^\t"/.test(line)) { cur = { tok, levels: {}, icons: {}, unrest: {} }; out.push(cur); section = null; lvl = null; continue; }
      if (tok === "settlement upgrade levels") { section = "levels"; lvl = null; continue; }
      if (tok === "settlement icons") { section = "icons"; continue; }
      if (tok === "unrest factors") { section = "unrest"; continue; }
      if (section === "levels" && cur) { lvl = tok; cur.levels[lvl] = {}; continue; }
      continue;
    }
    if (!cur) continue;
    m = /^"max settlement level"\s*:\s*"([a-z_]+)"/.exec(t);
    if (m) { cur.max = m[1]; continue; }
    if (section === "icons") {
      m = /^"([a-z_]+)"\s*:\s*"([^"]+)"/.exec(t);
      if (m) { cur.icons[m[1]] = m[2]; continue; }
    }
    if (section === "unrest") {
      m = /^"([a-z ]+)"\s*:\s*(-?[\d.]+)/.exec(t);
      if (m) { cur.unrest[m[1]] = parseFloat(m[2]); continue; }
    }
    if (section === "levels" && lvl) {
      m = /^"([a-z ]+)"\s*:\s*(-?\d+)/.exec(t);
      if (m) { cur.levels[lvl][m[1]] = parseInt(m[2], 10); continue; }
    }
  }
  return out;
}
const CULTURES = loadCultures(rd("descr_cultures.txt"));

// Two independent derivations of the same ladder. descr_sm_settlements declares it per culture
// as a nesting of level names; descr_cultures declares it per culture as the keys of the
// upgrade-levels block. They are different files with different syntax written for different
// purposes, so agreement is worth something.
const LADDER_A = SETTLE.order;
const LADDER_B = (() => {
  const seen = [];
  for (const c of CULTURES) for (const k of Object.keys(c.levels)) if (!seen.includes(k)) seen.push(k);
  return seen;
})();
const LADDER = LADDER_A.length >= LADDER_B.length ? LADDER_A : LADDER_B;
const LADDER_AGREE = LADDER_A.length === LADDER_B.length && LADDER_A.every((v, i) => LADDER_B[i] === v);
if (!LADDER.length) { console.error("no settlement ladder could be read — check descr_sm_settlements.txt and descr_cultures.txt"); process.exit(2); }
const rankOf = (s) => LADDER.indexOf(String(s || "").toLowerCase().replace(/\s+/g, "_"));

// ── 2. the population numbers, and whether the cultures agree ────────────────
const NUM_KEYS = ["upgrade", "min pop", "max pop", "squalour pop", "base"];
// The file's own comments, quoted rather than paraphrased — they are the only definition of
// these fields that exists anywhere in the mod.
const NUM_WORDS = {
  upgrade: ["Population needed to reach it", "population needed to upgrade to this level"],
  "min pop": ["Floor", "minimum population possible in this settlement"],
  "max pop": ["Overcrowding starts", "maximum population before overcrowding"],
  "squalour pop": ["Squalour doubles", "above this population, each extra pop counts double for squalour"],
  base: ["Base population", "the base population of this settlement before squalor kicks in"],
};
/** For one size and one field: the distinct values across every culture that declares it. */
function valuesFor(size, key) {
  const vals = new Map();      // value -> [culture, …]
  for (const c of CULTURES) {
    const b = c.levels[size];
    if (!b || b[key] == null) continue;
    if (!vals.has(b[key])) vals.set(b[key], []);
    vals.get(b[key]).push(c.tok);
  }
  return vals;
}
const numberDisagreements = [];
for (const s of LADDER) for (const k of NUM_KEYS) {
  const v = valuesFor(s, k);
  if (v.size > 1) numberDisagreements.push(`${s} / ${k}: ${[...v.entries()].map(([val, cs]) => `${val} (${cs.length} cultures)`).join(", ")}`);
}
const culturesDeclaring = (size) => CULTURES.filter((c) => c.levels[size] && Object.keys(c.levels[size]).length).length;

// ── 3. what each size unlocks, from export_descr_buildings.txt ───────────────
// Every level block, with the minimum size it declares. Counted a second way straight off the
// file text, because the first count is only as good as the parser and the parser has been
// wrong here before.
const LEVEL_MIN = new Map();     // "chain/level" -> size token
const levelsByMin = new Map();   // size token -> [{chain, level}]
let levelBlocks = 0, levelsWithMin = 0;
for (const c of EDB.chains) {
  for (const lv of Object.values(c.levels)) {
    levelBlocks++;
    if (!lv.settlementMin) continue;
    levelsWithMin++;
    LEVEL_MIN.set(`${c.chain.toLowerCase()}/${lv.level.toLowerCase()}`, lv.settlementMin);
    if (!levelsByMin.has(lv.settlementMin)) levelsByMin.set(lv.settlementMin, []);
    levelsByMin.get(lv.settlementMin).push({ chain: c.chain, level: lv.level });
  }
}
const RAW_MIN_LINES = (EDB_TXT.match(/^[ \t]*settlement_min[ \t]+[a-z_]+[ \t]*$/gim) || []);
const RAW_MIN_BY_SIZE = {};
for (const r of RAW_MIN_LINES) {
  const tok = r.trim().split(/\s+/)[1].toLowerCase();
  RAW_MIN_BY_SIZE[tok] = (RAW_MIN_BY_SIZE[tok] || 0) + 1;
}
// The two spellings the RTW documentation describes, searched for so the pages can say they are
// absent as a measured fact rather than an assumption.
const MIN_LEVEL_CLAUSES = (EDB_TXT.match(/settlement_min_level/gi) || []).length;
const MAX_LEVEL_CLAUSES = (EDB_TXT.match(/settlement_max_level/gi) || []).length;
const NEGATED_CLAUSES = (EDB_TXT.match(/not[ \t]+settlement_min/gi) || []).length;
// `settlement_min` is not a condition here, but the shared evaluator has an atom handler for it
// in case a mod writes one — so the number of `requires` expressions that actually contain the
// word is worth knowing, and it is the number that makes "negated clauses count" vacuous.
const IN_REQUIRES = [...EDB.chains].reduce((n, c) => n + Object.values(c.levels).filter((l) => /settlement_min/i.test(l.requires || "")).length, 0)
  + EDB.recruits.filter((r) => /settlement_min/i.test(r.requires || "")).length
  + EDB.effects.filter((e) => /settlement_min/i.test(e.requires || "")).length;

// A unit's own minimum: the smallest minimum across every level that can raise it. Keyed on the
// EDU dictionary so `sardinian archers`, `aor sardinian archers` and `horde sardinian archers`
// collapse into the one unit they are, exactly as the trade-good pages do it.
const unitMin = new Map();       // unit key -> { type, rank, at:Set("chain|level") }
let recruitLinesOrphan = 0;
for (const r of EDB.recruits) {
  const k = `${r.chain.toLowerCase()}/${String(r.level).toLowerCase()}`;
  if (!LEVEL_MIN.has(k)) { recruitLinesOrphan++; continue; }
  const rk = rankOf(LEVEL_MIN.get(k));
  if (rk < 0) continue;
  const key = TYPE_TO_DICT[r.unit] || `type:${r.unit}`;
  const e = unitMin.get(key);
  if (!e || rk < e.rank) unitMin.set(key, { type: r.unit, rank: rk, at: new Set([`${r.chain}|${r.level}`]) });
  else if (rk === e.rank) e.at.add(`${r.chain}|${r.level}`);
}
const unitsByMin = new Map();
for (const [, e] of unitMin) {
  const s = LADDER[e.rank];
  if (!unitsByMin.has(s)) unitsByMin.set(s, []);
  unitsByMin.get(s).push(e);
}

// ── 4. the campaign start, counted twice ─────────────────────────────────────
const STRAT_PATH = path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
const strat = gv.parseStrat(STRAT_PATH) || {};
const held = [];                 // {region, settlement, level, pop, faction, capital, builds}
const REGION_SETTLEMENT = (() => {
  const out = new Map();
  const lines = (rd("world", "maps", "base", "descr_regions.txt") || "").split(L.SPLIT_EOL);
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(lines[i])) continue;
    const body = [];
    for (let k = i + 1; k < Math.min(i + 14, lines.length); k++) {
      const t = lines[k].trim();
      if (!t || t.startsWith(";")) continue;
      if (/^[A-Za-z][A-Za-z0-9_'\- ]*$/.test(lines[k])) break;
      body.push(t);
    }
    const rgbAt = body.findIndex((l) => /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(l));
    if (rgbAt < 2) continue;
    out.set(lines[i].trim(), body[0]);
  }
  return out;
})();
for (const [fac, v] of Object.entries(strat)) {
  for (const s of (v.settlements || [])) {
    held.push({
      region: s.region, settlement: REGION_SETTLEMENT.get(s.region) || null,
      level: String(s.level || "").toLowerCase(), pop: s.pop, faction: fac,
      capital: !!s.capital, builds: (s.buildings || []).length,
    });
  }
}
const startBySize = new Map();
for (const h of held) {
  if (!startBySize.has(h.level)) startBySize.set(h.level, []);
  startBySize.get(h.level).push(h);
}
// The second derivation: a flat pattern over the same file with no block structure involved at
// all. If the parser ever loses a settlement block this is what says so.
const RAW_LEVELS = (() => {
  const out = {};
  let txt = "";
  try { txt = fs.readFileSync(STRAT_PATH, "latin1"); } catch { return out; }
  for (const m of txt.matchAll(/^[ \t]*level[ \t]+([a-z_]+)[ \t]*$/gim)) {
    const t = m[1].toLowerCase();
    out[t] = (out[t] || 0) + 1;
  }
  return out;
})();
const startCountsAgree = LADDER.every((s) => (startBySize.get(s) || []).length === (RAW_LEVELS[s] || 0))
  && Object.keys(RAW_LEVELS).every((s) => LADDER.includes(s));

// faction -> culture, for the distribution table
const FACTION_CULTURE = (() => {
  const out = {};
  let cur = null;
  for (const raw of (rd("descr_sm_factions.txt") || "").split(L.SPLIT_EOL)) {
    const line = raw.replace(/;.*$/, "");
    let m = /^\s*"([a-z0-9_]+)"\s*:\s*$/.exec(line);
    if (m && m[1] !== "factions") { cur = m[1].toLowerCase(); continue; }
    m = /"culture"\s*:\s*"([a-z_]+)"/.exec(line);
    if (m && cur) { out[cur] = m[1].toLowerCase(); cur = null; }
  }
  return out;
})();
let cultureUnknown = 0;
const cultureOf = (fac) => {
  const c = FACTION_CULTURE[String(fac).toLowerCase()];
  if (!c) cultureUnknown++;
  return c || null;
};

const settlementName = (tok) => PLACE_NAMES[String(tok).toLowerCase()] || String(tok).replace(/_/g, " ");
const settlementLink = (h) => {
  if (!h.settlement) return `\`${h.region}\``;
  const n = settlementName(h.settlement);
  return settlementPages.has(h.settlement) ? `[${n}](../settlements/${encodeURIComponent(h.settlement)}.md)` : n;
};

// ── 5. the art ───────────────────────────────────────────────────────────────
// Both files that declare a settlement image are read, because they declare DIFFERENT paths for
// the same culture and size — descr_sm_settlements points roman/village at
// `graeco-roman_village.tga` and descr_cultures points it at `roman_village.tga` — and only one
// of the two families is on disk at all. Which file a picture came from is stated on the page.
// TWO ROOTS, the mod first and the base game second — the same rule the faction symbols use.
// Looking only in the mod folder found four pictures, all of them the nomad set, so every size
// page led with a steppe camp; the base game ships the other six cultures' cities as loose files
// under ui/<culture>/cities/, roman among them, and all six rungs are there.
const VANILLA = valOf("--vanilla",
  "C:/Program Files (x86)/Steam/steamapps/common/Total War ROME REMASTERED/Contents/Resources/Data/data");
const artRoots = (p) => {
  const rel = String(p).replace(/\\/g, "/");
  return /^data\//i.test(rel)
    ? [path.join(RIS, rel.slice(5)), path.join(VANILLA, rel.slice(5))]
    : [path.join(RIS, "..", rel), path.join(VANILLA, "..", rel)];
};
const artPath = (p) => artRoots(p).find((f) => fs.existsSync(f)) || artRoots(p)[0];
function declaredArt() {
  const rows = [];   // {source, culture, size, rel, exists}
  // descr_sm_settlements: `<culture> { <size> { … card <path> } }`
  {
    let cul = null, lvl = null, depth = 0;
    for (const raw of (rd("descr_sm_settlements.txt") || "").split(L.SPLIT_EOL)) {
      const t = raw.replace(/;.*$/, "").trim();
      if (t === "{") { depth++; continue; }
      if (t === "}") { depth--; continue; }
      if (/^[a-z_]+$/.test(t) && depth === 0) { cul = t; continue; }
      if (/^[a-z_]+$/.test(t) && depth === 1) { lvl = t; continue; }
      const m = /^card\s+(\S+)/.exec(t);
      if (m && cul && lvl) rows.push({ source: "descr_sm_settlements.txt", culture: cul, size: lvl, rel: m[1], exists: fs.existsSync(artPath(m[1])) });
    }
  }
  for (const c of CULTURES) {
    for (const [size, rel] of Object.entries(c.icons)) {
      rows.push({ source: "descr_cultures.txt", culture: c.tok, size, rel, exists: fs.existsSync(artPath(rel)) });
    }
  }
  return rows;
}
const ART = declaredArt();
const ART_SCALE = 2;
function writeArt() {
  const dir = path.join(OUT, "settlement-cards");
  const present = ART.filter((r) => r.exists);
  if (!present.length) return { written: 0, bytes: 0, failed: [], bySize: new Map(), files: 0 };
  fs.mkdirSync(dir, { recursive: true });
  const byFile = new Map();      // absolute source -> png name
  const failed = [];
  let written = 0, bytes = 0;
  for (const r of present) {
    const abs = artPath(r.rel);
    if (byFile.has(abs)) { r.png = byFile.get(abs); continue; }
    try {
      const c = convertTga(dg, abs, ART_SCALE);
      if (!c) { failed.push(r.rel); continue; }
      const name = `${slug(path.basename(r.rel).replace(/\.tga$/i, ""))}.png`;
      fs.writeFileSync(path.join(dir, name), c.buf);
      byFile.set(abs, { name, w: c.w, h: c.h });
      r.png = byFile.get(abs);
      written++; bytes += c.buf.length;
    } catch { failed.push(r.rel); }
  }
  const bySize = new Map();
  for (const r of present) {
    if (!r.png) continue;
    if (!bySize.has(r.size)) bySize.set(r.size, []);
    bySize.get(r.size).push(r);
  }
  return { written, bytes, failed, bySize, files: byFile.size };
}
const ART_OUT = writeArt();

/** The art block for one size, or the empty state saying what was looked for. */
function artSection(size) {
  const mine = (ART_OUT.bySize.get(size) || []);
  const declared = ART.filter((r) => r.size === size);
  if (!mine.length) {
    return `_The mod declares **${declared.length}** settlement pictures for this size — `
      + `${uniq(declared.map((r) => r.rel)).length} distinct paths across ${uniq(declared.map((r) => r.culture)).length} cultures — `
      + `and **none of those files is in the mod folder**; they resolve into the base game's packed data, which these pages do not read._`;
  }
  // One entry per distinct picture, naming every culture that points at it, because the same
  // file is declared for several cultures and sometimes for several sizes.
  const byPng = new Map();
  for (const r of mine) {
    const k = r.png.name;
    if (!byPng.has(k)) byPng.set(k, { png: r.png, rel: r.rel, cultures: new Set(), sources: new Set() });
    byPng.get(k).cultures.add(r.culture);
    byPng.get(k).sources.add(r.source);
  }
  const shared = (name) => uniq([...ART_OUT.bySize.entries()]
    .filter(([s, rows]) => s !== size && rows.some((r) => r.png && r.png.name === name))
    .map(([s]) => sizeName(s)));
  const blocks = [...byPng.values()].map((e) => {
    const also = shared(e.png.name);
    return `<img src="../settlement-cards/${e.png.name}" alt="${sizeName(size)}" width="${e.png.w}" height="${e.png.h}">\n\n`
      + `Declared for **${[...e.cultures].sort().join(", ")}** in ${[...e.sources].sort().join(" and ")}, as \`${e.rel}\`.`
      + (also.length ? ` The same file is the mod's picture for ${also.join(" and ")} as well, so it is not art of its own.` : "");
  });
  const missing = declared.filter((r) => !r.exists);
  return blocks.join("\n\n") + (missing.length
    ? `\n\nThe other **${missing.length}** pictures declared for this size — ${uniq(missing.map((r) => r.culture)).length} cultures — point at files the mod folder does not contain.`
    : "");
}

// ── page assembly ────────────────────────────────────────────────────────────
const HEAD = (title) => `# ${title}\n\n[← settlement sizes](../sizes.md) · [all settlements](../settlements.md) · [wiki index](../README.md)\n`;

const PROVENANCE = [
  "<details>",
  "<summary>Where these answers come from</summary>",
  "",
  "The **ladder** is read from descr_sm_settlements.txt and checked against descr_cultures.txt; "
  + "both files declare it, per culture, and they agree. The **population figures** come from each "
  + "culture's `settlement upgrade levels` block in descr_cultures.txt, which is the only place in "
  + "the mod that puts a number on a settlement size — there is no `descr_settlement_mechanics.txt` "
  + "in RIS. **What a size unlocks** is read off the `settlement_min` field every building level "
  + "carries in export_descr_buildings.txt, and units are reached through the levels that can raise "
  + "them. Where the files establish nothing, the section says so with the number of things that "
  + "were examined, rather than being left silently empty.",
  "",
  "</details>",
].join("\n");

/** The population table for one size. */
function numbersTable(size) {
  const rows = [];
  for (const k of NUM_KEYS) {
    const vals = valuesFor(size, k);
    if (!vals.size) { rows.push(`| ${NUM_WORDS[k][0]} | _not determined_ | ${NUM_WORDS[k][1]} |`); continue; }
    const cell = vals.size === 1
      ? `**${num([...vals.keys()][0])}**`
      : [...vals.entries()].map(([v, cs]) => `${num(v)} (${cs.length === CULTURES.length ? "all" : cs.join(", ")})`).join(" · ");
    rows.push(`| ${NUM_WORDS[k][0]} | ${cell} | ${NUM_WORDS[k][1]} |`);
  }
  return `| | Population | What the mod file calls it |\n|---|---:|---|\n${rows.join("\n")}`;
}

function sizePage(size, i) {
  const name = sizeName(size);
  const prev = i > 0 ? LADDER[i - 1] : null;
  const next = i < LADDER.length - 1 ? LADDER[i + 1] : null;
  const levels = (levelsByMin.get(size) || []).slice().sort((a, b) => levelName(a.level).localeCompare(levelName(b.level)));
  const units = (unitsByMin.get(size) || []).slice().sort((a, b) => unitName(a.type).localeCompare(unitName(b.type)));
  const at = (startBySize.get(size) || []).slice().sort((a, b) => settlementName(a.settlement || a.region).localeCompare(settlementName(b.settlement || b.region)));
  const cumulativeLevels = LADDER.slice(0, i + 1).reduce((n, s) => n + (levelsByMin.get(s) || []).length, 0);
  const cumulativeUnits = LADDER.slice(0, i + 1).reduce((n, s) => n + (unitsByMin.get(s) || []).length, 0);

  const ladderLine = LADDER.map((s, k) => (k === i ? `**${sizeName(s)}**` : `[${sizeName(s)}](${s}.md)`)).join(" < ");

  // What it takes to reach it, in one sentence, from the numbers rather than about them.
  const upVals = valuesFor(size, "upgrade");
  const upSentence = upVals.size === 1
    ? (([...upVals.keys()][0] === 0)
      ? `Every settlement starts here: the mod asks for a population of **0** to be at this size, which is what makes it the bottom of the ladder.`
      : `A settlement reaches this size at a population of **${num([...upVals.keys()][0])}**, and all ${culturesDeclaring(size)} cultures that declare the figure declare the same one.`)
    : upVals.size ? `The cultures do not agree on the population it takes: ${[...upVals.entries()].map(([v, cs]) => `${num(v)} for ${cs.join(", ")}`).join("; ")}.`
      : `**Not determined** — no culture block in descr_cultures.txt gives a population for this size.`;

  const levelRows = levels.map((l) => {
    const ic = iconFor(l.level);
    return `| ${ic ? `<img src="../${ic}" alt="" width="32">` : ""} | ${levelLink(l.chain, l.level)} | ${chainLink(l.chain)} |`;
  });
  // The card column is dropped above CARDS_UPTO rows. One size gates almost the entire roster,
  // and 739 unit cards on one page is 34 MB of image the reader did not ask for — a browser
  // fetches what is inside a <details> whether it is open or not. A picture beside a name a
  // reader is scanning for earns its place; a wall of them does not.
  const CARDS_UPTO = 24;
  const withCards = units.length <= CARDS_UPTO;
  const unitRows = units.map((u) => {
    const at = uniq([...u.at].map((s) => { const [c, lv] = s.split("|"); return levelLink(c, lv); })).join(", ");
    return withCards ? `| ${unitCard(u.type)} | ${unitLink(u.type)} | ${at} |` : `| ${unitLink(u.type)} | ${at} |`;
  });
  const unitTable = (withCards ? `| | Unit | Raised at |\n|:-:|---|---|\n` : `| Unit | Raised at |\n|---|---|\n`) + unitRows.join("\n");
  const levelTable = `| | Level | Chain |\n|:-:|---|---|\n${levelRows.join("\n")}`;
  // Long tables go behind a fold, the same threshold the region pages use, so the sections
  // below them stay reachable without a page of scrolling.
  const FOLD_AT = 12;
  const maybeFold = (summary, n, table) => (n > FOLD_AT ? fold(summary, [table]) : table);

  const byFaction = new Map();
  for (const h of at) byFaction.set(h.faction, (byFaction.get(h.faction) || 0) + 1);
  const byCulture = new Map();
  for (const h of at) {
    const c = cultureOf(h.faction) || "not determined";
    byCulture.set(c, (byCulture.get(c) || 0) + 1);
  }

  const heldTotal = held.length;
  const startBody = at.length
    ? `**${num(at.length)}** of the ${num(heldTotal)} settlements the campaign file places begin at this size — `
      + `${(at.length / heldTotal * 100).toFixed(1)}% of them. `
      + `${at.filter((h) => h.capital).length} of those are a faction's capital.`
      + `\n\n${fold(`Who holds them (${byFaction.size} ${byFaction.size === 1 ? "faction" : "factions"})`, [
        "| Faction | Culture | Settlements |", "|---|---|---:|",
        ...[...byFaction.entries()].sort((a, b) => b[1] - a[1] || facName(a[0]).localeCompare(facName(b[0])))
          .map(([f, n]) => `| ${facLink(f)} | ${cultureOf(f) || "_not determined_"} | ${num(n)} |`),
      ])}`
      + `\n\n${fold(`Every settlement that begins at this size (${num(at.length)})`, [
        "| Settlement | Held by | Population | Buildings |", "|---|---|---:|---:|",
        ...at.map((h) => `| ${settlementLink(h)}${h.capital ? " ★" : ""} | ${facLink(h.faction)} | ${h.pop != null ? num(h.pop) : "—"} | ${h.builds} |`),
      ])}`
    : `**No settlement on the map begins at this size.** The campaign file places ${num(heldTotal)} settlements and gives every one of them a size; none of them is this one.`;

  const cultureReach = (() => {
    const canDeclared = CULTURES.filter((c) => rankOf(c.max) >= i);
    const cannot = CULTURES.filter((c) => rankOf(c.max) < i);
    const ladders = SETTLE.ladders;
    const shortLadders = [];
    // descr_sm_settlements is the file that gives a culture a strat-map MODEL per size, and
    // several of its ladders stop short of the six. That is a different statement from the
    // "max settlement level" in descr_cultures, and where the two differ the page says both
    // rather than choosing.
    {
      let cul = null, depth = 0;
      const seen = new Map();
      for (const raw of (rd("descr_sm_settlements.txt") || "").split(L.SPLIT_EOL)) {
        const t = raw.replace(/;.*$/, "").trim();
        if (t === "{") { depth++; continue; }
        if (t === "}") { depth--; continue; }
        if (/^[a-z_]+$/.test(t) && depth === 0) { cul = t; seen.set(cul, []); continue; }
        if (/^[a-z_]+$/.test(t) && depth === 1 && cul) seen.get(cul).push(t);
      }
      for (const [c, ls] of seen) if (ls.length && !ls.includes(size)) shortLadders.push(c);
    }
    const lines = [`All **${canDeclared.length}** of the ${CULTURES.length} cultures in descr_cultures.txt declare a \`max settlement level\` that reaches this size.`];
    if (cannot.length) lines[0] = `**${canDeclared.length}** of the ${CULTURES.length} cultures declare a \`max settlement level\` that reaches this size; ${cannot.length} stop below it (${cannot.map((c) => c.tok).join(", ")}).`;
    if (shortLadders.length) {
      lines.push(`But descr_sm_settlements.txt, which is where a culture gets its strategy-map model and card for each size, declares no block at this size for **${shortLadders.join(", ")}** — ${shortLadders.length === 1 ? "that culture has" : "those cultures have"} a shorter ladder in that file. Which of the two the engine obeys is **not determined** from the mod files; both are stated here because they differ.`);
    } else if (ladders) {
      lines.push(`All ${ladders} of the ladders in descr_sm_settlements.txt include it.`);
    }
    return lines.join("\n\n");
  })();

  const body = `${HEAD(name)}
${ladderLine}

${upSentence}${prev || next ? ` It is rung **${i + 1}** of ${LADDER.length}${prev && next ? `, above ${sizeName(prev)} and below ${sizeName(next)}` : prev ? `, above ${sizeName(prev)}` : `, below ${sizeName(next)}`}.` : ""}

${PROVENANCE}

## What it takes to reach it, and what holds it there

${numbersTable(size)}

${numberDisagreements.length === 0
    ? `Every one of the **${CULTURES.length}** cultures in descr_cultures.txt gives the same five numbers for every size, so these are the numbers for all of them.`
    : `The cultures do not agree on every figure; where they differ the cell above names who says what.`}

**What makes a settlement fall out of this size is not determined.** descr_cultures.txt states
the population needed to reach a size and the floor below which a settlement's population cannot
go, and nothing in the mod files states a demotion rule. The upgrade threshold of the rung below
is the obvious candidate and it is not what the file says, so it is not published here.

## Which cultures can reach it

${cultureReach}

## What it unlocks

### Building levels first buildable here — ${levels.length}

${levels.length
    ? `${levels.length === 1 ? "One level declares" : `**${levels.length}** levels declare`} \`settlement_min ${size}\`, so ${levels.length === 1 ? "it is" : "they are"} the ${levels.length === 1 ? "building" : "buildings"} a settlement can first put up on reaching this size. Counting everything from the bottom of the ladder up to here, **${num(cumulativeLevels)}** of the ${num(levelsWithMin)} building levels in the mod ${cumulativeLevels === 1 ? "is" : "are"} available at this size.

${maybeFold(`The ${levels.length} levels`, levels.length, levelTable)}`
    : `_No building level in the mod declares \`settlement_min ${size}\`. All ${num(levelsWithMin)} levels were checked. ${cumulativeLevels ? `The ${num(cumulativeLevels)} that are available at this size all became available lower down the ladder.` : "Nothing at all can be built at this size."}_`}

### Units first raisable here — ${units.length}

${units.length
    ? `**${units.length}** ${units.length === 1 ? "unit" : "units"} cannot be raised in a smaller settlement — the smallest building level that lists ${units.length === 1 ? "it" : "them"} needs this size. Cumulatively **${num(cumulativeUnits)}** of the ${num(unitMin.size)} distinct units the recruitment file names ${cumulativeUnits === 1 ? "is" : "are"} raisable at this size.${withCards ? "" : `\n\nThe roster cards are left off this table on purpose: at ${units.length} rows they would be ${units.length} images on one page. Each unit's own page has its card.`}

${maybeFold(`The ${units.length} units`, units.length, unitTable)}`
    : `_No unit first becomes raisable at this size. All ${num(EDB.recruits.length)} recruit lines in the mod were resolved to the ${num(unitMin.size)} distinct units they name, and each unit's minimum size taken from the smallest level that can raise it. ${cumulativeUnits ? `${num(cumulativeUnits)} of them are raisable at this size, every one of them from lower down the ladder.` : "None of them can be raised at this size at all."}_`}

### What it blocks — none

_Nothing in the mod is withheld for a settlement being **this large or larger**. The size clause
in export_descr_buildings.txt is \`settlement_min\`, a field on a building level rather than a
condition, and it appears **${num(RAW_MIN_LINES.length)}** times with **${NEGATED_CLAUSES}** of them negated —
a field cannot be. There is no \`settlement_max_level\` in the file (**${MAX_LEVEL_CLAUSES}** occurrences) and no
\`settlement_min_level\` either (**${MIN_LEVEL_CLAUSES}**), and **${IN_REQUIRES}** \`requires\` expressions in the whole
file mention a settlement size at all._

## At the campaign start

${startBody}

## The mod's picture of it

${artSection(size)}
`;
  fs.mkdirSync(path.join(OUT, "sizes"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "sizes", `${size}.md`), body, "utf8");
  return { size, name, levels: levels.length, units: units.length, start: at.length, cumulativeLevels, cumulativeUnits };
}

const PAGES = LADDER.map((s, i) => sizePage(s, i));

// ── the anchor index, for gen-ris-region-pages.js ────────────────────────────
// Published from the side that WRITES the headings, exactly as tags/index.json is. The region
// generator has its own copy of nothing here — it reads the page name and the display name from
// this file — so the two cannot disagree about what a size is called or where its page is.
const INDEX = {};
for (const p of PAGES) INDEX[p.size] = { page: `${p.size}.md`, name: p.name, anchor: anchor(p.name) };
fs.mkdirSync(path.join(OUT, "sizes"), { recursive: true });
fs.writeFileSync(path.join(OUT, "sizes", "index.json"), JSON.stringify(INDEX, null, 1), "utf8");

// ── the index page ───────────────────────────────────────────────────────────
const distinctCultures = uniq(held.map((h) => cultureOf(h.faction)).filter(Boolean)).sort();
const crossTab = (() => {
  const m = new Map();     // culture -> Map(size -> n)
  for (const h of held) {
    const c = cultureOf(h.faction) || "not determined";
    if (!m.has(c)) m.set(c, new Map());
    m.get(c).set(h.level, (m.get(c).get(h.level) || 0) + 1);
  }
  const rows = [...m.entries()]
    .map(([c, counts]) => ({ c, counts, total: [...counts.values()].reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.c.localeCompare(b.c));
  // A size with no settlement anywhere on the map gets no column. Village is one: the prose
  // above already says no settlement starts at that rung, and a column of twenty-two dashes
  // repeats it twenty-two times while making the table wide enough to be clipped. Computed,
  // not hardcoded — if a release ever starts a settlement at village, the column comes back.
  const used = LADDER.filter((s) => (startBySize.get(s) || []).length > 0);
  return [
    `| Culture | ${used.map((s) => sizeName(s)).join(" | ")} | Total |`,
    `|---|${used.map(() => "---:").join("|")}|---:|`,
    ...rows.map((r) => `| ${r.c} | ${used.map((s) => (r.counts.get(s) || 0) || "—").join(" | ")} | ${num(r.total)} |`),
    `| **All** | ${used.map((s) => num((startBySize.get(s) || []).length)).join(" | ")} | **${num(held.length)}** |`,
  ].join("\n");
})();

const indexBody = `# Settlement sizes

[← all settlements](settlements.md) · [all regions](regions.md) · [wiki index](README.md)

Every settlement in RIS sits on a ladder of **${LADDER.length}** sizes. The rung it is on decides three
things: what it can build, what it can raise, and how large it is allowed to grow before
overcrowding starts. These pages say what each rung does, one page per size.

${LADDER.map((s) => `[${sizeName(s)}](sizes/${s}.md)`).join(" < ")}

<details>
<summary>Where these answers come from</summary>

The ladder is declared twice — by ${SETTLE.ladders} cultures in descr_sm_settlements.txt and by
${CULTURES.length} in descr_cultures.txt — and both files give the same ${LADDER.length} names in the same order.
The population figures are descr_cultures.txt's own; there is no \`descr_settlement_mechanics.txt\`
in RIS, which was the first place looked. What each size unlocks is the \`settlement_min\` field
that every one of the ${num(levelsWithMin)} building levels in export_descr_buildings.txt carries, with units
reached through the levels that can raise them.

</details>

## The ladder

**Population** is what it takes to reach the rung; **ceiling** is the population above which
overcrowding starts. Both are the same for all ${CULTURES.length} cultures. **Builds** and **units** are what
*first* becomes available at that size — the cumulative figures are on each page.

| | Size | Population | Ceiling | Builds | Units | At the start |
|:-:|---|---:|---:|---:|---:|---:|
${PAGES.map((p) => {
  const up = valuesFor(p.size, "upgrade");
  const mx = valuesFor(p.size, "max pop");
  const one = (v) => (v.size === 1 ? num([...v.keys()][0]) : v.size ? "_varies_" : "_n/d_");
  // Only where the picture is this rung's OWN. Three of the six rungs are declared with a file
  // a lower rung already uses, and printing it again down the column reads as six pictures of
  // six sizes when it is four pictures of six sizes.
  // Roman where there is a Roman one. A size page is about the rung, not about a culture, so
  // the picture beside it is only ever an illustration of a rung — and with the base game's art
  // now readable, six cultures offer one. Picking whichever happened to sort first gave a
  // barbarian hillfort for four rungs and a steppe camp before that; Roman covers all six, so
  // the column reads as one settlement growing rather than six unrelated places.
  const rows = ART_OUT.bySize.get(p.size) || [];
  const art = rows.find((r) => r.culture === "roman" && r.png) || rows[0];
  const ownArt = art && art.png && !LADDER.slice(0, LADDER.indexOf(p.size))
    .some((s) => (ART_OUT.bySize.get(s) || []).some((r) => r.png && r.png.name === art.png.name));
  return `| ${ownArt ? `<img src="settlement-cards/${art.png.name}" alt="" width="48">` : ""} | [${p.name}](sizes/${p.size}.md) | ${one(up)} | ${one(mx)} | ${p.levels || "—"} | ${p.units || "—"} | ${num(p.start)} |`;
}).join("\n")}

${(() => {
  const own = LADDER.filter((s) => {
    const a = (ART_OUT.bySize.get(s) || [])[0];
    return a && a.png && !LADDER.slice(0, LADDER.indexOf(s)).some((p) => (ART_OUT.bySize.get(p) || []).some((r) => r.png && r.png.name === a.png.name));
  });
  const total = ART.length;
  if (!own.length) return `_The mod folder contains none of the ${total} settlement pictures its files declare; they resolve into the base game's packed data._`;
  return `Only **${ART_OUT.files}** of the **${total}** settlement pictures the mod's files declare are files in the mod folder — the rest resolve into the base game's packed data, which these pages do not read. Those ${ART_OUT.files} are the nomad set, and they cover ${own.length} of the ${LADDER.length} rungs; the rungs above ${sizeName(own[own.length - 1])} are declared with the same picture as ${sizeName(own[own.length - 1])}, so no thumbnail is shown for them.`;
})()}

## How the map is distributed

The campaign file places **${num(held.length)}** settlements and gives every one of them a size.
${(() => {
  const empty = LADDER.filter((s) => !(startBySize.get(s) || []).length);
  return empty.length
    ? `**${empty.map((s) => sizeName(s)).join(" and ")}** ${empty.length === 1 ? "is a rung no settlement starts on" : "are rungs no settlement starts on"} — ${empty.length === 1 ? "it exists" : "they exist"} in the rules and nowhere on the map at turn 0.`
    : "Every rung has at least one settlement on it at the campaign start.";
})()}

Culture is the owning faction's, from descr_sm_factions.txt${cultureUnknown ? `; ${num(cultureUnknown)} lookups found no culture and are shown as not determined` : ""}.
${(() => {
  // The largest row is not the largest PEOPLE. Whichever faction holds the most settlements
  // contributes all of them to its declared culture, and in RIS that is the unowned-territory
  // faction, so the top row of this table is mostly land nobody plays. Stated from the data
  // rather than left for a reader to be misled by.
  const byFac = new Map();
  for (const h of held) byFac.set(h.faction, (byFac.get(h.faction) || 0) + 1);
  const top = [...byFac.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return "";
  const share = top[1] / held.length;
  if (share < 0.2) return "";
  return `\nRead the largest row with care: **${facName(top[0])}** alone holds **${num(top[1])}** settlements — ${(share * 100).toFixed(0)}% of the map — and descr_sm_factions.txt gives that faction the culture \`${cultureOf(top[0]) || "not determined"}\`, so every one of them counts on that row. It is unclaimed ground, not a people.\n`;
})()}
${crossTab}

<details>
<summary>How each number on this page was counted, and checked</summary>

- **The ladder** — \`settlementRanks()\` over descr_sm_settlements.txt gives ${LADDER_A.join(" < ") || "nothing"}
  from ${SETTLE.ladders} culture blocks, ${SETTLE.disagree} of which disagree with the longest. The keys of the
  \`settlement upgrade levels\` block in descr_cultures.txt give ${LADDER_B.join(" < ") || "nothing"} across
  ${CULTURES.length} cultures. ${LADDER_AGREE ? "The two agree." : "**The two do not agree, and the longer one is used** — that disagreement is why this line exists."}
- **Population figures** — read per culture, then compared across all ${CULTURES.length} of them for each of the
  ${NUM_KEYS.length} fields at each of the ${LADDER.length} sizes, ${num(CULTURES.length * NUM_KEYS.length * LADDER.length)} values in all.
  ${numberDisagreements.length === 0 ? "Every culture gives the same number, so a single figure is published." : `${numberDisagreements.length} of those comparisons disagree and are published per culture.`}
- **Builds** — the \`settlement_min\` field on each building level, counted through the shared
  parser (${num(levelsWithMin)} of ${num(levelBlocks)} level blocks) and, independently, as a flat pattern over the
  file text (${num(RAW_MIN_LINES.length)} lines). ${levelsWithMin === RAW_MIN_LINES.length ? "The two agree." : "**The two disagree**, which means the parser is losing a level — see the run output."}
- **Units** — ${num(EDB.recruits.length)} recruit lines resolved to the ${num(unitMin.size)} distinct units they name, keyed on
  each unit's EDU \`dictionary\` so the same unit under three type names collapses to one.
  ${recruitLinesOrphan ? `${num(recruitLinesOrphan)} lines name a level their chain does not declare and are excluded.` : "Every line resolved to a level its chain declares."}
- **Settlements at the start** — ${num(held.length)} from the campaign parser, and ${num(Object.values(RAW_LEVELS).reduce((a, b) => a + b, 0))} \`level\` lines
  found by a flat pattern over the same file. ${startCountsAgree ? "The per-size counts agree exactly." : "**The per-size counts do not agree** — see the run output."}

</details>
`;
fs.writeFileSync(path.join(OUT, "sizes.md"), indexBody, "utf8");

// ── report ───────────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
say(`settlement sizes -> ${path.join(OUT, "sizes")} (+ sizes.md, sizes/index.json)`);
say(`  ladder, derived twice:`);
say(`    descr_sm_settlements.txt -> ${LADDER_A.join(" < ") || "(none)"}  (${SETTLE.ladders} culture ladders, ${SETTLE.disagree} disagreeing with the longest)`);
say(`    descr_cultures.txt       -> ${LADDER_B.join(" < ") || "(none)"}  (${CULTURES.length} cultures)`);
say(`    ${LADDER_AGREE ? "the two AGREE" : "the two DISAGREE — the longer is used and the page says so"}`);
say(`  display names from text/shared.txt ST_<SIZE>: ${sizeNameVia.declared.size}/${LADDER.length} resolved${sizeNameVia.fallback.size ? `, token printed for ${[...sizeNameVia.fallback].join(", ")}` : ""}`);
say(`  cultures reaching each size (descr_cultures "max settlement level"): ${LADDER.map((s, i) => `${s} ${CULTURES.filter((c) => rankOf(c.max) >= i).length}`).join(", ")}`);
say(`  population figures compared: ${num(CULTURES.length * NUM_KEYS.length * LADDER.length)} values (${CULTURES.length} cultures x ${NUM_KEYS.length} fields x ${LADDER.length} sizes), ${numberDisagreements.length} disagreements`);
for (const d of numberDisagreements) say(`    DISAGREE ${d}`);
say(`\n  export_descr_buildings.txt:`);
say(`    level blocks: ${num(levelBlocks)}; carrying a settlement_min: ${num(levelsWithMin)}`);
say(`    settlement_min lines by flat pattern: ${num(RAW_MIN_LINES.length)}  <- must equal the line above`);
say(`    ${levelsWithMin === RAW_MIN_LINES.length ? "the two counts AGREE" : "THE TWO COUNTS DISAGREE — a level block is being lost"}`);
say(`    per size, parser vs flat pattern: ${LADDER.map((s) => `${s} ${(levelsByMin.get(s) || []).length}/${RAW_MIN_BY_SIZE[s] || 0}`).join(", ")}`);
say(`    settlement_min_level occurrences: ${MIN_LEVEL_CLAUSES} · settlement_max_level: ${MAX_LEVEL_CLAUSES} · negated (not settlement_min): ${NEGATED_CLAUSES} · inside a requires expression: ${IN_REQUIRES}`);
say(`    recruit lines ${num(EDB.recruits.length)} -> ${num(unitMin.size)} distinct units${recruitLinesOrphan ? ` (${num(recruitLinesOrphan)} lines named a level their chain does not declare, excluded)` : " (every line resolved)"}`);
say(`    units first raisable at: ${LADDER.map((s) => `${s} ${(unitsByMin.get(s) || []).length}`).join(", ")}`);
say(`\n  campaign start, counted twice:`);
say(`    descr_strat parser: ${num(held.length)} settlements · ${LADDER.map((s) => `${s} ${(startBySize.get(s) || []).length}`).join(", ")}`);
say(`    flat "level <x>" pattern over the same file: ${num(Object.values(RAW_LEVELS).reduce((a, b) => a + b, 0))} · ${Object.entries(RAW_LEVELS).map(([s, n]) => `${s} ${n}`).join(", ")}`);
say(`    ${startCountsAgree ? "the per-size counts AGREE" : "THE PER-SIZE COUNTS DISAGREE"}`);
say(`    cultures represented: ${distinctCultures.length}${cultureUnknown ? ` · ${num(cultureUnknown)} culture lookups found nothing` : ""}`);
say(`\n  art:`);
say(`    settlement pictures declared: ${ART.length} (${ART.filter((r) => r.source === "descr_sm_settlements.txt").length} in descr_sm_settlements.txt, ${ART.filter((r) => r.source === "descr_cultures.txt").length} in descr_cultures.txt)`);
say(`    declared paths that are files in the mod folder: ${ART.filter((r) => r.exists).length} · distinct files: ${ART_OUT.files}`);
say(`    written to settlement-cards/: ${ART_OUT.written} PNG (${(ART_OUT.bytes / 1024).toFixed(0)} KB at 1/${ART_SCALE} scale)${ART_OUT.failed.length ? ` · ${ART_OUT.failed.length} failed to decode (${ART_OUT.failed.join(", ")})` : ""}`);
say(`    sizes with a picture: ${[...ART_OUT.bySize.keys()].join(", ") || "none"}${LADDER.filter((s) => !ART_OUT.bySize.has(s)).length ? ` · without: ${LADDER.filter((s) => !ART_OUT.bySize.has(s)).join(", ")}` : ""}`);
say(`    <- a zero in "failed" means nothing threw, not that the art is right; open one and look`);
say(`\n  links into other page families (absent families cost pictures and links, never facts):`);
say(`    building chain pages found: ${buildingPages.size} · unit pages ${unitPages.size} · settlement pages ${settlementPages.size} · faction pages ${factionPages.size} · unit cards ${cardFiles.size}`);
{
  const withIcon = [...levelsByMin.values()].flat().filter((l) => iconFor(l.level)).length;
  say(`    building icons: ${withIcon}/${num(levelsWithMin)} levels have one in icons/index.json (${Object.keys(ICONS).length} entries)`);
}
say(`    display names: ${levelNameMisses} building levels with no text entry, ${unitNameMisses} units with no name`);
say(`\n  pages written: ${PAGES.length} under sizes/, plus sizes.md and sizes/index.json`);
say(`  NEXT: run gen-ris-region-pages.js so the 1,311 settlement pages and settlements.md link their Size value here`);
