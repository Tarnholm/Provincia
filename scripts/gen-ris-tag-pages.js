#!/usr/bin/env node
/**
 * One reference page per KIND of region tag, so a region page can link every value it prints.
 *
 *   node scripts/gen-ris-tag-pages.js [--ris <dir>] [--out <dir>]
 *
 * A region page reads
 *
 *     Terrain              River valley
 *     Climate              mediterranean
 *     Recruitment zones    Syracusan, Greek, Gemina early
 *
 * and every one of those values used to be a dead end. This writes the pages they now point
 * at: terrain, climate, irrigation, ports, recruitment zones, specialty recruitment, cultural
 * homelands, hazards and river trade, and fertility.
 *
 * HOW "WHAT IT DOES" IS ESTABLISHED, and why that is the whole difficulty. Every one of these
 * tags is a HIDDEN RESOURCE. descr_sm_resources.txt declares each one as nothing but
 * `"subtype": "hidden"` — no name, no icon, no description, no effect. A hidden resource does
 * things only by being CONDITIONED ON somewhere else. So the honest, checkable question is not
 * "what does `karst_terrain` mean" but "what does the mod refuse to let you do where
 * `karst_terrain` is set", and that is answered by reading every `requires hidden_resource
 * <tag>` clause in export_descr_buildings.txt:
 *
 *   - on a building LEVEL          -> what you can and cannot build there
 *   - on a `recruit` line          -> what you can raise there
 *   - on an `<effect> N requires`  -> a NUMBER, with its condition
 *   - inside an `alias`            -> all of the above, one indirection away, which is where
 *                                     most of it actually lives (`water`, `extreme_cold`,
 *                                     `disabling_farms`, `<x>_homeland`)
 *
 * Negated clauses count. `not hidden_resource mountains` on five irrigation levels is a real
 * consequence of being mountainous, and reporting only the positive clauses would have missed
 * most of what the terrain tags do — and nearly all of what the recruitment tags do, since
 * they mask each other (`aor_greek` gives generic hoplites only where no more specific Greek
 * zone applies).
 *
 * WHERE THE FILES SAY NOTHING, THE PAGE SAYS SO. Five of the thirteen climates — monsoon,
 * dry sub-tropical, cold semi-arid, tropical, hot semi-arid — are conditioned on nowhere in
 * the mod. The entry reads "no effect established in the mod files" rather than describing
 * what the word suggests. Climate and terrain names are the tempting ones; they get the same
 * treatment as everything else.
 *
 * NO DISPLAY NAMES EXIST FOR THESE TOKENS. Checked, not assumed: the hidden-resource blocks in
 * descr_sm_resources.txt carry no `name` key at all, so unlike a trade good there is nothing to
 * look up in text/. The label is therefore humanised from the token exactly as
 * gen-ris-region-pages.js already does, so a value and its link read identically on both pages.
 * Everything that DOES have a display name uses it: building levels from
 * text/export_buildings.txt, units through their EDU `dictionary` into text/export_units.txt,
 * factions from text/campaign_descriptions.txt.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
// Heading anchors. Matches both GitHub's rule and the local viewer's slugId(), which is the
// pair that has to agree or every in-page link breaks in one of the two places.
const anchor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const L = require(path.join(__dirname, "lib", "edbRecruit.js"));

const edb = rd("export_descr_buildings.txt");
if (!edb) { console.error("export_descr_buildings.txt not found"); process.exit(2); }
const ALIASES = L.parseAliases(edb);
const EDB = L.parseEdb(edb);
const USAGE = L.tagUsage(EDB, ALIASES);

// ── display names ────────────────────────────────────────────────────────────
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return map;
}
const BUILDING_NAMES = loadText("export_buildings.txt");
const UNIT_TEXT = loadText("export_units.txt");
const FACTION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "campaign_descriptions.txt"), "utf16le");
    for (const m of t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_TITLE\}([^\r\n]*)/g)) out[m[1].toLowerCase()] = m[2].trim();
  } catch { /* tokens */ }
  return out;
})();

// EDU `type` -> `dictionary`. The type string is not a text key; the dictionary is, and it is
// also what gen-ris-unit-pages.js names its pages after, so both the display name and the page
// filename come from the same hop.
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

const unitPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "units")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
const buildingPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "buildings")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
const regionPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "regions")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();

let unitNameMisses = 0, unitPageMisses = 0;
/** A unit, by display name, linked to its page. Never the internal type string. */
function unitLink(type) {
  const dict = TYPE_TO_DICT[String(type).toLowerCase()];
  const name = dict ? UNIT_TEXT[dict] : null;
  if (!name) unitNameMisses++;
  const label = name || String(type).replace(/\b\w/g, (c) => c.toUpperCase());
  const p = dict ? slug(dict) : null;
  if (!p || !unitPages.has(p)) { if (p) unitPageMisses++; return `**${label}**`; }
  return `[**${label}**](../units/${p}.md)`;
}
const unitKey = (type) => TYPE_TO_DICT[String(type).toLowerCase()] || `type:${String(type).toLowerCase()}`;

let levelNameMisses = 0;
/** A building level, by display name, linked to its chain's page. */
function levelLink(chain, level) {
  const name = BUILDING_NAMES[String(level).toLowerCase()];
  if (!name) levelNameMisses++;
  const label = name || String(level).replace(/_/g, " ");
  const p = String(chain).toLowerCase();
  return buildingPages.has(p) ? `[${label}](../buildings/${p}.md)` : label;
}
const levelName = (level) => BUILDING_NAMES[String(level).toLowerCase()] || String(level).replace(/_/g, " ");
const facName = (f) => FACTION_NAMES[String(f).toLowerCase()] || String(f).replace(/_/g, " ");
const regionLink = (r) => (regionPages.has(r) ? `[${r.replace(/_/g, " ")}](../regions/${r}.md)` : r.replace(/_/g, " "));

// ── region tags ──────────────────────────────────────────────────────────────
// Same block walk as gen-ris-region-pages.js: indexed off the RGB line, because it is the only
// line whose shape is unmistakable and a stray comment inside a block shifts everything else.
function loadRegionTags() {
  const lines = (rd("world", "maps", "base", "descr_regions.txt") || "").split(L.SPLIT_EOL);
  const byTag = new Map();
  let regions = 0;
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
    regions++;
    for (const t of (body[rgbAt + 1] || "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const l = t.toLowerCase();
      if (!byTag.has(l)) byTag.set(l, []);
      byTag.get(l).push(lines[i].trim());
    }
  }
  return { byTag, regions };
}
const { byTag: REGIONS_OF, regions: REGION_COUNT } = loadRegionTags();

// ── the categories ───────────────────────────────────────────────────────────
// TERRAIN_TAGS, CLIMATE_TAGS, IRRIGATION_TAGS and SPECIALTY_AOR are copied from
// gen-ris-region-pages.js, which copied them from Provincia's own src/RegionInfo.js.
// src/regionTagCategories.test.js reads both source files and fails if they drift, so the app
// and the wiki cannot end up disagreeing about whether `mediterranean` is a terrain.
const TERRAIN_TAGS = new Set([
  "river_valley", "floodplains_delta", "grassland", "mountain_valley", "forest",
  "steppe", "hills", "wetlands", "small_islands_and_rocky_coast", "plateau",
  "karst_terrain", "mountains", "desert",
]);
const CLIMATE_TAGS = new Set([
  "mediterranean", "humid_sub_tropical", "monsoon", "temperate", "oceanic",
  "continental", "dry_sub_tropical", "cold_semi_arid", "alpine", "sub_artic",
  "tropical", "hot_semi_arid", "arid",
]);
const IRRIGATION_TAGS = new Set([
  "irrigation_river", "irrigation_springs", "irrigation_lake", "irrigation_aquifer", "irrigation_oasis",
]);
const SPECIALTY_AOR = new Set([
  "aor_camillan", "aor_euzonoi", "aor_deuteroi", "aor_oscan_southern", "aor_thracian_hillmen",
]);

// descr_sm_resources.txt is where these tokens are DECLARED, so it is the vocabulary of
// record — a tag can exist there while appearing on no region and in no condition, and that
// is worth reporting rather than losing.
const DECLARED_HIDDEN = (() => {
  const out = new Set();
  const txt = rd("descr_sm_resources.txt") || "";
  for (const m of txt.matchAll(/"([A-Za-z0-9_\-]+)"\s*:\s*\{([\s\S]*?)\n\s*\}/g)) {
    if (/"subtype"\s*:\s*"hidden"/.test(m[2])) out.add(m[1].toLowerCase());
  }
  return out;
})();

// The vocabulary of a prefix category is the union of three sources — what the resources file
// declares, what the map uses, and what the buildings file conditions on. Deliberately not one
// of the three, because every mismatch is a real finding: a declared tag on no region is dead
// data, a tag on the map that nothing conditions on unlocks nothing, and a tag conditioned on
// that no region carries is a rule that can never fire.
const unionOf = (re, exclude) => [...new Set([...DECLARED_HIDDEN, ...REGIONS_OF.keys(), ...USAGE.keys()])]
  .filter((t) => re.test(t) && !(exclude && exclude.has(t))).sort();

const PORT_TAGS = unionOf(/^base_port_level_\d+$/).sort((a, b) => (+a.replace(/\D+/g, "")) - (+b.replace(/\D+/g, "")));
const ZONE_TAGS = unionOf(/^aor_/, SPECIALTY_AOR);
const HOMELAND_TAGS = unionOf(/^homeland_/);
const FARM_TAGS = unionOf(/^farm\d+$/).sort((a, b) => (+a.replace(/\D+/g, "")) - (+b.replace(/\D+/g, "")));
// The hazard row on a region page, plus every disaster token descr_sm_resources declares.
// `rivertrade` is the only one any region actually carries. The disaster names are there
// because they were the obvious place to look for an earthquake rule and finding nothing is
// the answer — descr_disasters.txt keys earthquakes off climate and named seas instead, and
// the one line in export_descr_buildings.txt that mentions `earthquakes` is commented out.
const HAZARD_TAGS = ["rivertrade", "seatrade", "earthquake", "earthquakes", "floods", "storms", "volcano"]
  .filter((t) => DECLARED_HIDDEN.has(t) || REGIONS_OF.has(t) || USAGE.has(t));

// ── the other files that could give a tag a meaning ──────────────────────────
// export_descr_buildings.txt is where nearly everything happens, but it is not the only file
// that can read a hidden resource, and "nothing conditions on this" is a strong enough claim
// that it has to be checked everywhere rather than in the one obvious place. These are the
// remaining consumers: the campaign script and the spawn scripts can add or test one, the
// mercenary pools and the rebel-faction blocks can name one.
//
// The scan is a plain token search, deliberately: a false POSITIVE here only weakens the claim
// to "referenced somewhere else, go and look", while a false negative would let the page say
// nothing uses a tag when something does.
const OTHER_CONSUMERS = (() => {
  const files = [];
  const add = (p) => { const t = rd(p); if (t != null) files.push([p, t]); };
  add(path.join("world", "maps", "campaign", "imperial_campaign", "RIS_Campaign_Script.txt"));
  add(path.join("world", "maps", "campaign", "imperial_campaign", "descr_mercenaries.txt"));
  add("descr_rebel_factions.txt");
  const spawnDir = path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "spawn_scripts");
  try {
    for (const f of fs.readdirSync(spawnDir).filter((n) => n.endsWith(".txt"))) {
      add(path.join("world", "maps", "campaign", "imperial_campaign", "spawn_scripts", f));
    }
  } catch { /* no spawn scripts */ }
  return files;
})();
const otherConsumerHits = (tok) => {
  const re = new RegExp(`\\b${String(tok).replace(/[^a-z0-9_]/gi, "")}\\b`, "i");
  return OTHER_CONSUMERS.filter(([, t]) => re.test(t)).map(([p]) => path.basename(p));
};

const TAG_PREFIXES = [
  [/^aor_/, ""], [/^homeland_/, ""], [/^base_port_level_/, "port level "], [/^farm/i, "farm level "],
];
function humanise(tok) {
  let s = String(tok);
  for (const [re, repl] of TAG_PREFIXES) if (re.test(s)) { s = s.replace(re, repl); break; }
  s = s.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return String(tok);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── effect wording ───────────────────────────────────────────────────────────
// Only the effect kinds that a tag in one of these categories is actually conditioned on. The
// list was taken from the file rather than written from memory: those are farming_level,
// taxable_income_bonus, population_growth_bonus, law_bonus, trade_base_income_bonus, the four
// construction_time_bonus_*, trade_fleet, road_level, trade_level_bonus and happiness_bonus.
const sgn = (n) => (n >= 0 ? `+${n}` : String(n));
const EFFECT_WORDS = {
  farming_level: (n) => `farming level ${sgn(n)}`,
  taxable_income_bonus: (n) => `taxable income ${sgn(n)}`,
  population_growth_bonus: (n) => `population growth ${sgn(n)}`,
  law_bonus: (n) => `public order (law) ${sgn(n)}`,
  happiness_bonus: (n) => `public order (happiness) ${sgn(n)}`,
  trade_base_income_bonus: (n) => `trade income ${sgn(n)}`,
  trade_level_bonus: (n) => `trade level ${sgn(n)}`,
  trade_fleet: (n) => `trade fleet ${sgn(n)}`,
  road_level: (n) => `road level ${sgn(n)}`,
  construction_time_bonus_military: (n) => `military construction time ${sgn(n)}%`,
  construction_time_bonus_religious: (n) => `religious construction time ${sgn(n)}%`,
  construction_time_bonus_defensive: (n) => `defensive construction time ${sgn(n)}%`,
  construction_time_bonus_other: (n) => `other construction time ${sgn(n)}%`,
  construction_cost_bonus_defensive: (n) => `defensive construction cost ${sgn(n)}%`,
  religious_belief: (n, subject) => `${subject ? subject.replace(/_/g, " ") : "religious"} belief ${sgn(n)}`,
};
const unknownEffects = new Set();
function effectWords(e, amount) {
  const n = amount == null ? e.amount : amount;
  const f = EFFECT_WORDS[e.effect];
  if (!f) { unknownEffects.add(e.effect); return `\`${e.effect}\` ${sgn(n)}`; }
  return f(n, e.subject);
}
/** "farming level +2" or, where a level declares several amounts, "farming level +2 to +3". */
function effectRange(e) {
  if (e.min == null || e.min === e.max) return effectWords(e, e.min);
  return `${effectWords(e, e.min)} to ${sgn(e.max)}`;
}

// ── one entry's facts ────────────────────────────────────────────────────────
const uniq = (arr) => [...new Set(arr)];
const fold = (summary, lines) => `<details><summary>${summary}</summary>\n\n${lines.join("\n")}\n\n</details>`;

function factsFor(tok) {
  const u = USAGE.get(tok) || { levels: [], recruits: [], effects: [], aliases: [], blockedLevels: [], blockedRecruits: [], blockedEffects: [] };
  const regions = REGIONS_OF.get(tok) || [];
  const lv = uniq(u.levels.map((x) => `${x.chain}|${x.level}`)).map((s) => s.split("|"));
  const bl = uniq(u.blockedLevels.map((x) => `${x.chain}|${x.level}`)).map((s) => s.split("|"));
  const units = new Map();          // unit key -> { type, levels:Set }
  for (const r of u.recruits) {
    const k = unitKey(r.unit);
    if (!units.has(k)) units.set(k, { type: r.unit, levels: new Set() });
    units.get(k).levels.add(`${r.chain}|${r.level}`);
  }
  const blockedUnits = new Map();
  for (const r of u.blockedRecruits) {
    const k = unitKey(r.unit);
    if (!blockedUnits.has(k)) blockedUnits.set(k, { type: r.unit, levels: new Set() });
    blockedUnits.get(k).levels.add(`${r.chain}|${r.level}`);
  }
  // Effects, grouped by WHAT they are and WHERE, and stated as a range when a level declares
  // the same effect at several amounts. One building level often does: Land Clearance gives
  // farming level 1, 2, 2 or 3 depending on wet climate crossed with whether the region grows
  // grain. Listing those as four separate facts reads as a contradiction. As a range it reads
  // as the true comparison — with a Mediterranean climate that level gives 2 to 3, without it
  // 1 to 2.
  const group = (arr) => {
    const m = new Map();
    for (const e of arr) {
      const k = `${e.effect}|${e.subject || ""}|${e.chain}|${e.level}`;
      const g = m.get(k);
      if (!g) m.set(k, { ...e, min: e.amount, max: e.amount });
      else { g.min = Math.min(g.min, e.amount); g.max = Math.max(g.max, e.amount); }
    }
    return m;
  };
  const eff = group(u.effects);
  const beff = group(u.blockedEffects);
  return { tok, name: humanise(tok), regions, levels: lv, blockedLevels: bl, units, blockedUnits, effects: eff, blockedEffects: beff, aliases: u.aliases };
}

const NOTHING = "**No effect established in the mod files.** Nothing in " +
  "export_descr_buildings.txt requires it, excludes it, or keys a number off it.";

/** The body of one `## <name>` entry, as a bullet list of established facts. */
function entryBody(f, opts) {
  opts = opts || {};
  const out = [];
  const nRegions = f.regions.length;
  out.push(nRegions
    ? `On **${nRegions}** ${nRegions === 1 ? "region" : "regions"}.`
    : "**No region carries this tag.**");

  const bullets = [];
  const levelList = (arr) => uniq(arr.map(([c, l]) => levelLink(c, l))).join(", ");
  if (f.levels.length) bullets.push(`**Lets you build** — ${f.levels.length} building ${f.levels.length === 1 ? "level" : "levels"}: ${levelList(f.levels)}`);
  if (f.blockedLevels.length) bullets.push(`**Blocks** — ${f.blockedLevels.length} building ${f.blockedLevels.length === 1 ? "level" : "levels"}: ${levelList(f.blockedLevels)}`);
  const effWords = (m) => uniq([...m.values()].map((e) => `${effectRange(e)} (${levelName(e.level)})`));
  if (f.effects.size) bullets.push(`**Numeric effects where it is present** — ${effWords(f.effects).join("; ")}`);
  if (f.blockedEffects.size) bullets.push(`**Numeric effects it withholds** — these are granted only where it is absent: ${effWords(f.blockedEffects).join("; ")}`);
  if (!opts.unitsSeparate) {
    if (f.units.size) bullets.push(`**Lets you raise** — ${f.units.size} ${f.units.size === 1 ? "unit" : "units"}: ${[...f.units.values()].map((x) => unitLink(x.type)).join(", ")}`);
    if (f.blockedUnits.size) bullets.push(`**Withholds** — ${f.blockedUnits.size} ${f.blockedUnits.size === 1 ? "unit" : "units"} other tags would otherwise give`);
  }
  if (bullets.length) { out.push(""); out.push(...bullets.map((b) => `- ${b}`)); }
  else if (!opts.unitsSeparate || (!f.units.size && !f.blockedUnits.size)) { out.push(""); out.push(NOTHING); }
  return out.join("\n");
}

/** The units table used by the two recruitment pages. */
function unitTable(f) {
  const rows = [...f.units.values()]
    .map((x) => ({ x, name: (UNIT_TEXT[TYPE_TO_DICT[x.type] || ""] || x.type) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [
    "| Unit | Raised at |",
    "|---|---|",
    ...rows.map(({ x }) => {
      const at = uniq([...x.levels].map((s) => { const [c, l] = s.split("|"); return levelLink(c, l); })).join(", ");
      return `| ${unitLink(x.type)} | ${at} |`;
    }),
  ].join("\n");
}

function regionsFold(f, what) {
  if (!f.regions.length) return null;
  const list = [...f.regions].sort().map(regionLink).join(" · ");
  return fold(`${what} (${f.regions.length})`, [list]);
}

// ── page assembly ────────────────────────────────────────────────────────────
const HEAD = (title) => `# ${title}\n\n[← reference tables](../tags.md) · [all regions](../regions.md) · [wiki index](../README.md)\n`;

const PROVENANCE = "What each value **does** is read off the clauses the mod conditions on it — " +
  "`requires hidden_resource <tag>` on a building level, on a `recruit` line, or on a numeric " +
  "effect in export_descr_buildings.txt, including the ones reached through an `alias`. " +
  "Negated clauses count: blocking something is an effect. Where nothing in the files " +
  "conditions on a value, the entry says **no effect established** rather than describing what " +
  "the word suggests.";

function summaryTable(list, cols) {
  return [`| ${cols.map((c) => c[0]).join(" | ")} |`,
    `|${cols.map((c) => (c[2] === "r" ? "---:" : "---")).join("|")}|`,
    ...list.map((f) => `| ${cols.map((c) => c[1](f)).join(" | ")} |`)].join("\n");
}

function simplePage(title, file, tokens, lede, opts) {
  opts = opts || {};
  const list = tokens.map(factsFor);
  const nothing = list.filter((f) => !f.levels.length && !f.blockedLevels.length && !f.effects.size
    && !f.blockedEffects.size && !f.units.size && !f.blockedUnits.size);
  const body = `${HEAD(title)}
${lede}

${PROVENANCE}

**${list.length}** values. ${list.length - nothing.length} have an effect established in the files; ${nothing.length} do not.

${summaryTable(list, [
    [opts.header || "Value", (f) => `[${f.name}](#${anchor(f.name)})`],
    ["Regions", (f) => f.regions.length.toLocaleString("en-US"), "r"],
    ["Builds", (f) => (f.levels.length || "—"), "r"],
    ["Blocks", (f) => (f.blockedLevels.length || "—"), "r"],
    ["Effects", (f) => (f.effects.size + f.blockedEffects.size || "—"), "r"],
    ["Units", (f) => (f.units.size || "—"), "r"],
  ])}

${list.map((f) => `## ${f.name}\n\n${entryBody(f)}\n\n${regionsFold(f, opts.regionsLabel || "Regions") || ""}`).join("\n\n")}
`;
  fs.mkdirSync(path.join(OUT, "tags"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "tags", file), body, "utf8");
  return { list, nothing };
}

// ── recruitment zones ────────────────────────────────────────────────────────
// The page this whole generator exists for. Per zone: every unit it unlocks and the building
// level each is raised at, every region in the zone, and the two counts.
function recruitmentPage(title, file, tokens, lede) {
  const list = tokens.map(factsFor);
  const noUnits = list.filter((f) => !f.units.size);
  const noRegions = list.filter((f) => !f.regions.length);
  const dead = list.filter((f) => !f.units.size && !f.regions.length);
  const allUnits = new Set();
  for (const f of list) for (const k of f.units.keys()) allUnits.add(k);

  const entry = (f) => {
    const head = `## ${f.name}\n\n**${f.regions.length}** ${f.regions.length === 1 ? "region" : "regions"} · **${f.units.size}** ${f.units.size === 1 ? "unit" : "units"}`;
    const parts = [head];
    if (!f.units.size && !f.regions.length) {
      parts.push(`\n${NOTHING} No region carries it either, so it is dead data in the mod.`);
    } else if (!f.units.size) {
      const other = otherConsumerHits(f.tok);
      parts.push(`\n**No unit is gated on this zone.** ${f.regions.length} ${f.regions.length === 1 ? "region carries" : "regions carry"} it, but no \`recruit\` line in export_descr_buildings.txt conditions on it, ${other.length ? `and the only other files that name it are ${other.join(", ")}` : `and the ${OTHER_CONSUMERS.length} other files that could read a hidden resource — the campaign script, the mercenary pools, the rebel-faction blocks and the spawn scripts — do not mention it at all`}. So as the mod ships it unlocks nothing.`);
    } else if (!f.regions.length) {
      parts.push(`\n**No region carries this zone**, so the ${f.units.size} ${f.units.size === 1 ? "unit" : "units"} below cannot be raised anywhere on the map as it ships.`);
      parts.push("\n" + unitTable(f));
    } else {
      parts.push("\n" + unitTable(f));
    }
    const extra = [];
    if (f.blockedUnits.size) extra.push(`- Carrying this zone **withholds ${f.blockedUnits.size}** ${f.blockedUnits.size === 1 ? "unit" : "units"} that a broader zone would otherwise give — that is how the generic rosters step aside for a local one.`);
    if (f.levels.length) extra.push(`- Also lets you build: ${uniq(f.levels.map(([c, l]) => levelLink(c, l))).join(", ")}`);
    if (extra.length) parts.push("\n" + extra.join("\n"));
    const rf = regionsFold(f, "Regions in this zone");
    if (rf) parts.push("\n" + rf);
    return parts.join("\n");
  };

  const body = `${HEAD(title)}
${lede}

${PROVENANCE}

**${list.length}** zones, covering **${allUnits.size}** distinct units. ${list.length - noUnits.length} unlock at least one unit; ${list.length - noRegions.length} cover at least one region.${noUnits.length ? ` **${noUnits.length}** unlock nothing: ${noUnits.map((f) => f.name).join(", ")}.` : ""}${noRegions.length ? ` **${noRegions.length}** ${noRegions.length === 1 ? "is" : "are"} on no region at all: ${noRegions.map((f) => f.name).join(", ")}.` : ""}${dead.length ? ` ${dead.length} ${dead.length === 1 ? "is" : "are"} both.` : ""}

${summaryTable([...list].sort((a, b) => b.units.size - a.units.size || a.name.localeCompare(b.name)), [
    ["Zone", (f) => `[${f.name}](#${anchor(f.name)})`],
    ["Units", (f) => (f.units.size || "—"), "r"],
    ["Regions", (f) => (f.regions.length || "—"), "r"],
  ])}

${list.map(entry).join("\n\n")}
`;
  fs.mkdirSync(path.join(OUT, "tags"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "tags", file), body, "utf8");
  return { list, noUnits, noRegions, dead, allUnits };
}

// ── cultural homelands ───────────────────────────────────────────────────────
// A homeland tag is the one category whose effect is not per-tag at all: `homeland_massaliote`
// exists so the mod can write `alias massaliote_homeland { requires factions { massalia, } and
// hidden_resource homeland_massaliote }`, and all ~220 of those aliases are or-ed together into
// a single `homeland` condition. So the effect is stated once, for the whole category, and each
// entry carries the fact that identifies it: which faction it belongs to, and where.
function homelandPage() {
  const list = HOMELAND_TAGS.map(factsFor);
  // Which faction each tag is bound to, read from the alias that names it.
  const owner = new Map();
  for (const [name, bodyExpr] of Object.entries(ALIASES)) {
    const hr = /hidden_resource\s+(homeland_[a-z0-9_]+)/i.exec(bodyExpr);
    const fac = /factions\s*\{([^}]*)\}/i.exec(bodyExpr);
    if (hr && fac) {
      const facs = fac[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (!owner.has(hr[1].toLowerCase())) owner.set(hr[1].toLowerCase(), { alias: name, factions: facs });
    }
  }
  const gov4 = EDB.byChain.get("governmentd");
  const govLevels = uniq((USAGE.get(HOMELAND_TAGS.find((t) => (USAGE.get(t) || { levels: [] }).levels.length) || "") || { levels: [] })
    .levels.map((x) => `${x.chain}|${x.level}`)).map((s) => s.split("|"));
  const blocked = uniq([].concat(...list.map((f) => f.blockedLevels.map(([c, l]) => `${c}|${l}`)))).map((s) => s.split("|"));
  const noOwner = list.filter((f) => !owner.has(f.tok));
  const noRegion = list.filter((f) => !f.regions.length);

  const body = `${HEAD("Cultural homelands")}
A homeland tag marks the region a faction comes from. **${list.length}** of them exist, one per
faction with a homeland, and between them they cover **${list.reduce((a, f) => a + f.regions.length, 0).toLocaleString("en-US")}** of the
${REGION_COUNT.toLocaleString("en-US")} regions on the map.

${PROVENANCE}

**They all do the same thing, and the effect is not per-tag.** Each one exists so the mod can
write a paired condition — \`requires factions { massalia, } and hidden_resource
homeland_massaliote\` — and all ${owner.size} of those pairs are or-ed together into one
\`homeland\` condition. That condition is what has consequences:

- **It is required by ${govLevels.length ? uniq(govLevels.map(([c, l]) => levelLink(c, l))).join(", ") : "the Homeland government level"}.** A faction can only install that government in its own homeland${gov4 ? `, and that level carries ${EDB.recruits.filter((r) => r.chain === "governmentD").length.toLocaleString("en-US")} recruit lines of its own` : ""}.
- **It blocks ${blocked.length} other levels**: ${blocked.map(([c, l]) => levelLink(c, l)).join(", ")}. Your own homeland cannot be given a lesser government, made a colony, or given a local mint.
- The tag only counts **for the faction it belongs to**. Anyone else holding the region gets nothing from it — the condition tests the owner as well as the tag.

${summaryTable(list, [
    ["Homeland", (f) => `[${f.name}](#${anchor(f.name)})`],
    ["Faction", (f) => (owner.get(f.tok) ? owner.get(f.tok).factions.map(facName).join(", ") : "_not determined_")],
    ["Regions", (f) => (f.regions.length || "—"), "r"],
  ])}

${list.map((f) => {
    const o = owner.get(f.tok);
    const lines = [`## ${f.name}`, ""];
    lines.push(o
      ? `The homeland of **${o.factions.map(facName).join(", ")}**.`
      : "**Not determined which faction this belongs to** — no condition in export_descr_buildings.txt pairs it with a faction.");
    lines.push(f.regions.length
      ? `${f.regions.length === 1 ? "Region" : "Regions"}: ${[...f.regions].sort().map(regionLink).join(" · ")}`
      : "**No region carries this tag**, so it can never be satisfied as the mod ships.");
    return lines.join("\n");
  }).join("\n\n")}
`;
  fs.mkdirSync(path.join(OUT, "tags"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "tags", "cultural-homeland.md"), body, "utf8");
  return { list, owner, noOwner, noRegion, blocked, govLevels };
}

// ── build ────────────────────────────────────────────────────────────────────
const terrain = simplePage("Terrain", "terrain.md", [...TERRAIN_TAGS].sort(),
  `Every region on the map carries one terrain tag. Terrain decides which of the mod's competing\nland-use chains you may build — farms, irrigated farming, rainfed farming, the four\npastoralism chains, qanats, marsh reclamation — and several of them carry a standing penalty.`,
  { header: "Terrain", regionsLabel: "Regions with this terrain" });

const climate = simplePage("Climate", "climate.md", [...CLIMATE_TAGS].sort(),
  `Climate sits alongside terrain: a region carries one of each. Where a climate does anything, it\nis usually through the farming level the rainfed farming chain grants, which is set higher in\ndry climates than wet ones — the tag chooses which of the two numbers a level gives.`,
  { header: "Climate", regionsLabel: "Regions with this climate" });

const irrigation = simplePage("Irrigation", "irrigation.md", [...IRRIGATION_TAGS].sort(),
  `A region's water source. Four of the five satisfy the mod's \`water\` condition, which is what\nthe irrigated farming chain and the larger colony need; the aquifer is the exception and feeds\nthe qanat chain instead. Having any of them also rules the rainfed farming chain out.`,
  { header: "Water source", regionsLabel: "Regions with this water source" });

const ports = simplePage("Ports", "ports.md", PORT_TAGS,
  `How good a natural harbour the coast gives, before you build anything. The tag is what the port\nand harbour chains test, so it decides how far up those chains a settlement can go.`,
  { header: "Port level", regionsLabel: "Regions at this port level" });

const hazards = simplePage("Hazards and river trade", "hazards-and-river-trade.md", HAZARD_TAGS,
  `The leftovers of the region tag line: a navigable-river flag and the disaster tags. They are\ngrouped because that is how a region page groups them, not because they are alike.`,
  { header: "Tag", regionsLabel: "Regions with this tag" });

const fertility = simplePage("Fertility", "fertility.md", FARM_TAGS,
  `A region's farmland quality, on a 1–14 scale, carried as a \`farm\` tag. This is the number the\nFertility row on a region page shows. Note what it does and does not do: the engine adds\n+0.5% population growth per fertility point, and the region-information building subtracts\nexactly that back again, so fertility describes the land without changing how fast it grows.`,
  { header: "Fertility", regionsLabel: "Regions at this fertility" });

const zones = recruitmentPage("Recruitment zones", "recruitment-zones.md", ZONE_TAGS,
  `A recruitment zone is a region tag that unlocks local troops. Hold a region inside the zone,\nbuild the military building the unit needs, and you may raise it — whoever you are. This is how\nRIS lets an empire field the men of the places it has taken rather than only its own.\n\nZones overlap, and the broader one steps aside: a unit gated on \`Greek\` is usually also gated\non the region *not* being in a more specific Greek zone, so the generic hoplite appears where\nthere is no local speciality and the local speciality appears where there is.`);

const specialty = recruitmentPage("Specialty recruitment", "specialty-recruitment.md", [...SPECIALTY_AOR].sort(),
  `Five zones that mark a kind of soldier or a military era rather than a place. Provincia's own\nregion panel keeps them on a separate tab and the region pages give them their own row, so they\nget their own page here too. Mechanically they are ordinary recruitment zones.`);

const homeland = homelandPage();

// ── index page ───────────────────────────────────────────────────────────────
const PAGES = [
  ["Terrain", "tags/terrain.md", terrain.list.length, "which land-use chains a region allows"],
  ["Climate", "tags/climate.md", climate.list.length, "the farming level rainfed farming gives"],
  ["Irrigation", "tags/irrigation.md", irrigation.list.length, "the water source, and what it unlocks"],
  ["Ports", "tags/ports.md", ports.list.length, "how far the port and harbour chains can go"],
  ["Recruitment zones", "tags/recruitment-zones.md", zones.list.length, "local troops, per zone, with every region in it"],
  ["Specialty recruitment", "tags/specialty-recruitment.md", specialty.list.length, "the five zones that mark a soldier, not a place"],
  ["Cultural homelands", "tags/cultural-homeland.md", homeland.list.length, "which region is whose, and what that permits"],
  ["Hazards and river trade", "tags/hazards-and-river-trade.md", hazards.list.length, "the navigable-river flag and the disaster tags"],
  ["Fertility", "tags/fertility.md", fertility.list.length, "farmland quality, 1–14, and what it does not do"],
];
// An anchor index, written for gen-ris-region-pages.js to link against. The region generator
// humanises the same tokens with its own copy of the same rules, and if the two ever disagreed
// by a character every link would land on a page with no matching heading — which nothing would
// catch, because verify-ris-wiki.js checks that the FILE exists, not the fragment. Publishing
// the anchors from the side that writes the headings removes the question.
const ANCHORS = {};
const record = (page, list) => { for (const f of list) ANCHORS[f.tok] = { page, anchor: anchor(f.name), name: f.name }; };
record("terrain.md", terrain.list);
record("climate.md", climate.list);
record("irrigation.md", irrigation.list);
record("ports.md", ports.list);
record("hazards-and-river-trade.md", hazards.list);
record("fertility.md", fertility.list);
record("recruitment-zones.md", zones.list);
record("specialty-recruitment.md", specialty.list);
record("cultural-homeland.md", homeland.list);
fs.writeFileSync(path.join(OUT, "tags", "index.json"), JSON.stringify(ANCHORS, null, 1), "utf8");

const indexBody = `# Region tag reference

[← all regions](regions.md) · [wiki index](README.md)

A region page lists what the region *is* — its terrain, climate, water source, port, recruitment
zones, homeland and fertility. These pages say what each of those values **does**, with every
value in every category listed once.

${PROVENANCE}

| Reference | Values | What it decides |
|---|---:|---|
${PAGES.map(([t, f, n, d]) => `| [${t}](${f}) | ${n} | ${d} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "tags.md"), indexBody, "utf8");

// ── report ───────────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
say(`region tag reference -> ${path.join(OUT, "tags")} (+ tags.md)`);
say(`  descr_regions: ${REGION_COUNT.toLocaleString("en-US")} regions, ${REGIONS_OF.size} distinct tags`);
say(`  export_descr_buildings: ${EDB.chains.length} chains, ${EDB.recruits.length.toLocaleString("en-US")} recruit lines, ${EDB.effects.length.toLocaleString("en-US")} conditional effects, ${Object.keys(ALIASES).length} aliases`);
say(`  hidden-resource tokens conditioned on anywhere: ${USAGE.size}`);
for (const [label, r] of [["terrain", terrain], ["climate", climate], ["irrigation", irrigation],
  ["ports", ports], ["hazards", hazards], ["fertility", fertility]]) {
  say(`  ${label.padEnd(10)} ${String(r.list.length).padStart(3)} values, ${r.list.length - r.nothing.length} with an effect established, ${r.nothing.length} without${r.nothing.length ? ` (${r.nothing.map((f) => f.tok).join(", ")})` : ""}`);
}
say(`  zones      ${String(zones.list.length).padStart(3)} values, ${zones.allUnits.size} distinct units unlocked`);
say(`             ${zones.noUnits.length} unlock no unit: ${zones.noUnits.map((f) => f.tok).join(", ") || "none"}`);
say(`             ${zones.noRegions.length} on no region: ${zones.noRegions.map((f) => f.tok).join(", ") || "none"}`);
say(`  specialty  ${String(specialty.list.length).padStart(3)} values, ${specialty.allUnits.size} distinct units unlocked, ${specialty.noUnits.length} unlock nothing, ${specialty.noRegions.length} on no region`);
say(`  homelands  ${String(homeland.list.length).padStart(3)} values, ${homeland.owner.size} paired with a faction, ${homeland.noOwner.length} not determined, ${homeland.noRegion.length} on no region`);
say(`  display names: ${levelNameMisses} building levels with no text entry, ${unitNameMisses} units with no name, ${unitPageMisses} units whose page is missing`);
say(`  anchor index -> tags/index.json: ${Object.keys(ANCHORS).length} tokens a region page can link`);
say(`  other files scanned before claiming a tag unlocks nothing: ${OTHER_CONSUMERS.length} (campaign script, mercenary pools, rebel factions, spawn scripts)`);
{
  const named = zones.noUnits.filter((f) => otherConsumerHits(f.tok).length);
  say(`    of the ${zones.noUnits.length} zones with no unit, ${named.length} are named in one of those files${named.length ? ` (${named.map((f) => f.tok).join(", ")})` : ""}`);
}
if (unknownEffects.size) say(`  effect kinds with no wording (shown as the raw key): ${[...unknownEffects].join(", ")}`);
