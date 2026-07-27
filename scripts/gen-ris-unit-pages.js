#!/usr/bin/env node
/**
 * One wiki page per RIS unit, plus a roster index with the stats table.
 *
 *   node scripts/gen-ris-unit-pages.js [--ris <dir>] [--out <dir>] [--only <unit,…>]
 *
 * Stats come from export_descr_unit.txt; names and descriptions from
 * text/export_units.txt, keyed by each unit's `dictionary` field.
 *
 * THE `dictionary` FIELD IS THE KEY, and finding that mattered. A unit's `type` string
 * (`aor arab levy spearmen`) has NO entry in the text file, so an earlier pass concluded
 * unit names were unresolvable and left 1,697 raw tokens across the wiki. Each EDU block
 * carries `dictionary arab_levy_spearmen`, and THAT resolves - to the display name, plus
 * `_descr` and `_descr_short` for the prose.
 *
 * PLACEHOLDER DESCRIPTIONS ARE REPORTED AS MISSING, not printed. RIS ships many units with
 * the literal text "This unit needs a long description." Passing that through would fill
 * the wiki with text that looks like content and is not, so it is treated as absent and
 * counted, which also tells the team how much writing is outstanding.
 *
 * MERCENARIES ARE NAMED AS SUCH. A mercenary is identified by its EDU `type` beginning
 * `merc `, NOT by the `mercenary_unit` attribute. Measured on the reference data: 1,697 EDU
 * entries, 770 carry the attribute, and those 770 are exactly the 320 `merc ` types PLUS all
 * 450 `aor ` types — every area-of-recruitment unit carries it too, so the attribute
 * over-matches by 2.4x and would have labelled half the regional roster as hireable.
 *
 * Corroborated independently: descr_mercenaries.txt, the file that actually decides what can
 * be hired, names 258 distinct unit types and every one of them is `merc `-prefixed. Two
 * unrelated files agree on the same 320-type population, so the prefix is the marker.
 *
 * NOT DONE: unit cards. The images live in the mod's UI folders as TGA, and turning ~1,700
 * of them into web-usable PNGs is a separate job - see the note at the foot of units.md.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const ONLY = (valOf("--only", "") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// Text the mod ships as a stand-in for writing it later. Treated as absent.
const PLACEHOLDER = /this unit needs a (long|short) description/i;

// ── mercenaries ──────────────────────────────────────────────────────────────
// The marker is the `merc ` prefix on the EDU `type`, for the reasons in the header comment.
// Kept as one named constant so the two places that need it cannot drift apart.
const MERC_TYPE = /^merc\s/i;
// Do not prefix a name the mod already wrote as a mercenary's: 201 of the 319 mercenary
// dictionaries are called "Mercenary Cretan Archers" and the like already, and one
// ("Dravidian Mercenaries") puts the word last.
const ALREADY_MERC = /mercenar/i;

function loadText() {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "export_units.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* tokens then */ }
  return map;
}

/** Split an EDU block into its fields. Values may repeat (two `officer` lines), so arrays. */
function parseBlocks(edu) {
  const out = [];
  let cur = null;
  for (const raw of edu.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const m = /^(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, key, val] = m;
    if (key === "type") { cur = { type: val.trim(), fields: {} }; out.push(cur); continue; }
    if (!cur) continue;
    (cur.fields[key] = cur.fields[key] || []).push(val.trim());
  }
  return out;
}

const first = (b, k) => (b.fields[k] ? b.fields[k][0] : null);
const csv = (b, k) => (first(b, k) || "").split(",").map((s) => s.trim());
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

function statsOf(b) {
  const pri = csv(b, "stat_pri");          // attack, charge, missile?, range, ammo, type, tech, dmg, weapon, delay, ...
  const armour = csv(b, "stat_pri_armour"); // armour, defence skill, shield, material...
  const mental = csv(b, "stat_mental");     // morale, discipline, training
  const cost = csv(b, "stat_cost");         // turns, cost, upkeep, weapon, armour, total?
  const soldier = csv(b, "soldier");        // model, count, extras, mass
  return {
    men: num(soldier[1]),
    attack: num(pri[0]),
    charge: num(pri[1]),
    weapon: pri[8] || null,
    armour: num(armour[0]),
    defence: num(armour[1]),
    shield: num(armour[2]),
    morale: num(mental[0]),
    discipline: mental[1] || null,
    training: mental[2] || null,
    turns: num(cost[0]),
    cost: num(cost[1]),
    upkeep: num(cost[2]),
  };
}

// ── who can actually recruit each unit ───────────────────────────────────────
// The faction pages answer "what can this faction raise". This is the reverse, which is
// the question a reader on a unit page has. Split the same way, on the hidden_resource gate
// the engine enforces: the core list is short and meaningful, while regional availability
// is usually "everyone, if they take the right province" and so is reported as a count.
function loadAvailability() {
  const edb = rd("export_descr_buildings.txt") || "";
  const byType = new Map();   // unit type -> { core:Set, aor:Set }
  for (const m of edb.matchAll(/^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+([^\r\n]+)/gm)) {
    const type = m[1].trim().toLowerCase();
    const expr = m[3];
    const hr = /hidden_resource/i.test(expr);
    const pos = [], neg = [];
    for (const fm of expr.matchAll(/(not\s+)?factions\s*\{([^}]*)\}/gi)) {
      const list = fm[2].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      (fm[1] ? neg : pos).push(...list);
    }
    let e = byType.get(type);
    if (!e) { e = { core: new Set(), aor: new Set(), all: false, allCore: false, neg: new Set() }; byType.set(type, e); }
    for (const n of neg) e.neg.add(n);
    if (pos.includes("all")) { e.all = true; if (!hr) e.allCore = true; continue; }
    for (const f of pos) (hr ? e.aor : e.core).add(f);
  }
  return byType;
}
const availability = loadAvailability();

// ── where a mercenary is hired ────────────────────────────────────────────────
// descr_mercenaries.txt is the file that decides this, and it has nothing to do with
// buildings: a `pool` covers a list of regions and offers units at a price, optionally
// `restrict`ed to named factions. Only 6 of the 320 mercenary types have an EDB recruit line
// at all, so without this file 314 mercenary pages said "no recruitment route for this unit
// was found in the building files" — which reads as missing data when the truth is that
// mercenaries are hired, not built.
function loadMercPools() {
  const txt = rd("world", "maps", "campaign", "imperial_campaign", "descr_mercenaries.txt") || "";
  const byType = new Map();   // unit type -> { pools:Set, regions:Set, restrict:Set, openToAll:bool, cost:[], exp:[] }
  let pool = null, regions = [];
  let poolCount = 0, lineCount = 0;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.replace(/;.*$/, "").trim();
    if (!l) continue;
    let m = /^pool\s+(.+)$/.exec(l);
    if (m) { pool = m[1].trim(); regions = []; poolCount++; continue; }
    m = /^regions\s+(.+)$/.exec(l);
    if (m) { regions = m[1].trim().split(/\s+/).filter(Boolean); continue; }
    // `unit merc cretan archers, exp 3 cost 5683 replenish … max 1 initial 1 restrict achaea`
    m = /^unit\s+([^,]+),(.*)$/.exec(l);
    if (!m || !pool) continue;
    lineCount++;
    const type = m[1].trim().toLowerCase();
    const rest = m[2];
    let e = byType.get(type);
    if (!e) { e = { pools: new Set(), regions: new Set(), restrict: new Set(), openToAll: false, cost: [], exp: [] }; byType.set(type, e); }
    e.pools.add(pool);
    for (const r of regions) e.regions.add(r);
    const rs = /restrict\s+(.+)$/.exec(rest);
    if (rs) for (const f of rs[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) e.restrict.add(f);
    else e.openToAll = true;   // this pool sells to anyone who owns the ground
    const c = /\bcost\s+(\d+)/.exec(rest); if (c) e.cost.push(+c[1]);
    const x = /\bexp\s+(\d+)/.exec(rest); if (x) e.exp.push(+x[1]);
  }
  // Reported so a format change that stops the parse matching cannot pass for "this mod has
  // no mercenary pools".
  console.log(`mercenary pools parsed: ${poolCount} · unit offers: ${lineCount} · distinct types offered: ${byType.size}`);
  return byType;
}
const mercPools = loadMercPools();

// Only link factions that actually have a page — slave, the senate and the dummy factions
// are excluded from the wiki, and linking them was 1,006 broken links once already.
const factionPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "factions")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();

// The nine factions that are not choosable. They still appear in recruitment gates — 74 unit
// types name one — and dropping them silently made a unit recruitable only by the senate read
// as recruitable by nobody. They share one reference page instead of having pages of their own.
// MUST match the list in gen-ris-faction-pages.js, which writes that page.
const NON_PLAYABLE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
// Written by gen-ris-faction-pages.js, which the documented build order runs after this one.
const NON_PLAYABLE_PAGE = "../factions/non-playable.md";

// Region pages, so a mercenary pool's provinces can be reached from the unit that is sold
// there. Files are named for the region token, spaces and underscores as the mod writes them.
const regionPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "regions")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
// The region token is not the region's name: `Ager_Gallicus` is displayed "Ager Gallicus",
// and the mod ships the mapping for all 1,311 of them.
const REGION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "imperial_campaign_regions_and_settlement_names.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) out[m[1].trim()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return out;
})();
const regionName = (r) => REGION_NAMES[r] || String(r).replace(/_/g, " ");

const prettyFaction = (f) => String(f).split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// Faction display names, from the same source the faction pages use for their own titles, so
// the two never disagree: campaign_descriptions.txt names the faction as the campaign-select
// screen shows it ("Rome", not "Romans Julii"). expanded_bi.txt covers the factions with no
// campaign entry — `slave` is "Free Peoples" there and has no campaign title at all.
const FACTION_NAMES = (() => {
  const out = {};
  const readLut = (file) => {
    const m = {};
    try {
      const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
      for (const x of t.matchAll(/\{([^}]+)\}(.*)/g)) { const k = x[1].trim().toLowerCase(); if (!(k in m)) m[k] = x[2].trim(); }
    } catch { /* fall back to the token */ }
    return m;
  };
  const camp = readLut("campaign_descriptions.txt");
  const exp = readLut("expanded_bi.txt");
  for (const [k, v] of Object.entries(camp)) {
    const m = /^imperial_campaign_([a-z0-9_]+)_title$/.exec(k);
    if (m && v) out[m[1]] = v;
  }
  for (const [k, v] of Object.entries(exp)) if (v && !(k in out)) out[k] = v;
  return out;
})();
const factionName = (f) => FACTION_NAMES[String(f).toLowerCase()] || prettyFaction(f);
// `seleucid_rebels` and `seleucid_rebels2` are both displayed "Seleucid Rebels", and a unit
// gated on both listed the same name twice with no way to tell which was which. Where a
// display name is shared, the token goes with it.
const NP_NAME_SHARED = (() => {
  const n = {};
  for (const f of NON_PLAYABLE) n[factionName(f)] = (n[factionName(f)] || 0) + 1;
  return n;
})();
const factionLink = (f) => {
  const label = factionName(f);
  if (NON_PLAYABLE.has(f)) {
    const tag = NP_NAME_SHARED[label] > 1 ? ` \`${f}\`` : "";
    return `[${label}${tag}](${NON_PLAYABLE_PAGE}) _(not playable)_`;
  }
  return factionPages.has(f) ? `[${label}](../factions/${f}.md)` : label;
};

// ── build ────────────────────────────────────────────────────────────────────
const edu = rd("export_descr_unit.txt");
if (!edu) { console.error("export_descr_unit.txt not found"); process.exit(2); }
const T = loadText();
const blocks = parseBlocks(edu).filter((b) => b.type);
if (!blocks.length) { console.error("no unit blocks parsed"); process.exit(2); }

let named = 0, described = 0, placeholder = 0;
const rows = [];

for (const b of blocks) {
  const dict = (first(b, "dictionary") || "").toLowerCase();
  const name = (dict && T[dict]) || null;
  if (name) named++;
  const longD = dict ? T[dict + "_descr"] : null;
  const shortD = dict ? T[dict + "_descr_short"] : null;
  const clean = (s) => {
    if (!s) return null;
    if (PLACEHOLDER.test(s)) { return null; }
    // The text files encode paragraph breaks as the literal two chars \ and n.
    return s.replace(/\\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join("\n\n").trim() || null;
  };
  const isPh = (s) => !!s && PLACEHOLDER.test(s);
  if (isPh(longD) || isPh(shortD)) placeholder++;
  const L = clean(longD), S = clean(shortD);
  if (L || S) described++;

  rows.push({
    type: b.type, dict, name: name || b.type, rawName: name, hasName: !!name,
    isMercType: MERC_TYPE.test(b.type),
    category: first(b, "category"), cls: first(b, "class"),
    ownership: first(b, "ownership"),
    attributes: (first(b, "attributes") || "").split(",").map((s) => s.trim()).filter(Boolean),
    st: statsOf(b), long: L, short: S,
    slug: slug(b.type),
  });
}

// ── MERGE AOR / HORDE VARIANTS ───────────────────────────────────────────────
// Many "units" are the same unit reached a different way. `sardinian archers`,
// `aor sardinian archers` and `horde sardinian archers` are one troop type with three
// recruitment routes, and all three share the dictionary key `sardinian_archers`.
// Keying pages on `type` produced 1,697 pages for 1,172 actual units, and saved ~500
// cards that were byte-identical images under different names.
//
// So the DICTIONARY is the identity and `type` is a variant of it. On the reference data:
// 1,697 types -> 1,172 dictionaries, 454 of which hold more than one type, covering 979
// types. 450 types begin "aor ".
//
// Stats are taken from the first variant and the others are checked against it; where they
// disagree the page says so rather than quietly presenting one variant's numbers as the
// unit's.
//
// MERCENARY STATUS IS DECIDED PER DICTIONARY, and a dictionary that mixed mercenary and
// non-mercenary types would be genuinely ambiguous: the page would be claiming a unit is
// hired when it can also be built, or the reverse. Measured on the reference data there are
// NONE — 1,172 dictionaries split 319 entirely mercenary / 853 entirely not, zero mixed — so
// the case is handled explicitly rather than assumed away: a mixed dictionary is NOT
// prefixed (the unit is obtainable without hiring it, so calling it a mercenary would be
// wrong), it says on its own page that it is reachable both ways, and the count is printed.
// If that count ever moves off zero, the run says so instead of quietly picking a side.
const merged = [];
let mercUnits = 0, mercAlreadyNamed = 0, mercPrefixed = 0, mixedDicts = [];
{
  const byDict = new Map();
  for (const r of rows) {
    const key = r.dict || `__notype_${r.slug}`;
    if (!byDict.has(key)) byDict.set(key, []);
    byDict.get(key).push(r);
  }
  for (const [key, group] of byDict) {
    const head = group[0];
    const cmp = (a, b) => a.st.attack === b.st.attack && a.st.defence === b.st.defence
      && a.st.armour === b.st.armour && a.st.morale === b.st.morale && a.st.cost === b.st.cost;
    const nMerc = group.filter((g) => g.isMercType).length;
    const mercKind = nMerc === 0 ? "none" : nMerc === group.length ? "all" : "mixed";
    if (mercKind === "mixed") mixedDicts.push(key);
    let name = head.name;
    if (mercKind === "all") {
      mercUnits++;
      // Only prefix a real display name. Where the mod ships no name the fallback is the
      // internal type, which already begins "merc " — prefixing that would read as nonsense.
      if (head.hasName) {
        if (ALREADY_MERC.test(head.rawName)) mercAlreadyNamed++;
        else { name = `Mercenary ${head.rawName}`; mercPrefixed++; }
      }
    }
    merged.push({
      ...head,
      name,
      slug: slug(key),
      merc: mercKind,
      variants: group.map((g) => g.type),
      statsDiffer: group.some((g) => !cmp(g, head)),
    });
  }
}

const list = ONLY.length
  ? merged.filter((r) => ONLY.includes(r.type.toLowerCase()) || ONLY.includes(r.dict))
  : merged;
fs.mkdirSync(path.join(OUT, "units"), { recursive: true });

// ── where a stat sits in the roster ──────────────────────────────────────────
// A bare "Defence skill 33" means nothing without the roster to compare against, and RIS
// stats run far above vanilla, so borrowed intuition misleads. Each stat therefore also
// shows its rank among all units that have that stat. Drawn with block characters rather
// than a styled <span>: GitHub strips style attributes when it renders markdown, so a CSS
// bar would work in the local viewer and silently vanish on the site.
const SORTED = {};
for (const k of ["attack", "charge", "armour", "defence", "shield", "morale", "cost", "upkeep", "men"]) {
  SORTED[k] = merged.map((u) => u.st[k]).filter((v) => v != null).sort((a, b) => a - b);
}
function percentile(key, v) {
  const arr = SORTED[key];
  if (!arr || !arr.length || v == null) return null;
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return Math.round((lo / arr.length) * 100);
}
const BAR_CELLS = 10;
function bar(key, v) {
  const p = percentile(key, v);
  if (p == null) return "";
  const filled = Math.max(1, Math.round((p / 100) * BAR_CELLS));
  return `\`${"█".repeat(filled)}${"·".repeat(BAR_CELLS - filled)}\` ${p}%`;
}

// The mod's descriptions embed their own section headers as bare ALL-CAPS lines
// ("HISTORICAL BACKGROUND" on 428 units, "GENERAL DESCRIPTION" on 2). Left as-is they read
// as a shouted line in the middle of a wall of prose; promoted to real headings they give
// the page a structure and a table of contents entry.
function sectionise(text) {
  if (!text) return text;
  return text.replace(/^([A-Z][A-Z0-9 '\-]{5,})$/gm, (_, h) => {
    const t = h.trim().toLowerCase();
    return `### ${t.charAt(0).toUpperCase() + t.slice(1)}`;
  });
}

for (const u of list) {
  const s = u.st;
  const stat = (label, v, suffix, key) => v == null ? "" :
    `| ${label} | ${v.toLocaleString("en-US")}${suffix || ""} | ${key ? bar(key, v) : ""} |\n`;

  // Availability, unioned across every variant of this unit: an AOR variant and its parent
  // are one page here, so the page must answer for all of them.
  const avail = { core: new Set(), aor: new Set(), all: false, allCore: false };
  for (const v of u.variants) {
    const e = availability.get(String(v).toLowerCase());
    if (!e) continue;
    for (const f of e.core) if (!e.neg.has(f)) avail.core.add(f);
    for (const f of e.aor) if (!e.neg.has(f)) avail.aor.add(f);
    if (e.all) avail.all = true;
    if (e.allCore) avail.allCore = true;
  }
  // A faction is listed if the wiki can take the reader somewhere for it: its own page, or
  // the shared non-playable page. Names sort by what the game calls them, not by the token.
  const known = (f) => factionPages.has(f) || NON_PLAYABLE.has(f);
  const coreList = [...avail.core].filter(known).sort((a, b) => factionName(a).localeCompare(factionName(b)));
  const aorCount = [...avail.aor].filter(known).length;

  // Mercenary pools, unioned across every variant of this unit, same as availability above.
  const hire = { pools: new Set(), regions: new Set(), restrict: new Set(), openToAll: false, cost: [], exp: [] };
  for (const v of u.variants) {
    const e = mercPools.get(String(v).toLowerCase());
    if (!e) continue;
    for (const p of e.pools) hire.pools.add(p);
    for (const r of e.regions) hire.regions.add(r);
    for (const f of e.restrict) hire.restrict.add(f);
    if (e.openToAll) hire.openToAll = true;
    hire.cost.push(...e.cost); hire.exp.push(...e.exp);
  }
  const rng = (a) => (a.length ? (Math.min(...a) === Math.max(...a) ? Math.min(...a).toLocaleString("en-US") : `${Math.min(...a).toLocaleString("en-US")}–${Math.max(...a).toLocaleString("en-US")}`) : null);
  const hireRegions = [...hire.regions].filter((r) => regionPages.has(r)).sort();
  // A pool can cover 200 provinces; the first 40 make the point and the rest are counted.
  const REGION_CAP = 40;
  const hireSection = u.merc === "none" ? "" : `## Where to hire it

${hire.pools.size ? `Mercenaries are **hired from a regional pool, not recruited from a building**. This unit is
offered by **${hire.pools.size} pool${hire.pools.size === 1 ? "" : "s"}** covering **${hire.regions.size} region${hire.regions.size === 1 ? "" : "s"}**${rng(hire.cost) ? `, at **${rng(hire.cost)} dn** to hire` : ""}${rng(hire.exp) ? ` and **${rng(hire.exp)} experience**` : ""}.

${hire.openToAll
  ? `At least one of those pools sells to **any faction** that has an army in range — no faction restriction.`
  : hire.restrict.size
    ? `Every pool offering it is restricted. Only these factions can hire it:\n\n${[...hire.restrict].sort((a, b) => factionName(a).localeCompare(factionName(b))).map(factionLink).join(" · ")}`
    : `_The pool lines carry no faction restriction the parser recognised._`}
${hire.restrict.size && hire.openToAll ? `\nSome pools additionally restrict it to ${[...hire.restrict].sort((a, b) => factionName(a).localeCompare(factionName(b))).map(factionLink).join(" · ")}.\n` : ""}
<details>
<summary>The ${hire.regions.size} region${hire.regions.size === 1 ? "" : "s"} where this unit appears in a mercenary pool</summary>

${hireRegions.slice(0, REGION_CAP).map((r) => `[${regionName(r)}](../regions/${encodeURIComponent(r)}.md)`).join(" · ")}${hireRegions.length > REGION_CAP ? `\n\n_…and ${hireRegions.length - REGION_CAP} more._` : ""}${hire.regions.size !== hireRegions.length ? `\n\n_${hire.regions.size - hireRegions.length} region name${hire.regions.size - hireRegions.length === 1 ? "" : "s"} in the pool file has no region page — listed in descr_mercenaries but not in descr_regions._` : ""}

</details>

> The **Recruitment cost** in the stats table above is the EDU figure the engine uses for
> building-recruited units. What you actually pay for this unit is the pool price above.`
  : `This unit is defined as a mercenary but **no mercenary pool in descr_mercenaries.txt offers
it**, so there is nowhere on the campaign map to hire it as the mod ships today.${coreList.length || avail.all ? " It is reachable only through the building route below." : ""}`}

`;
  // Every unit has two pieces of art: the roster card shown in the recruitment panel and
  // the info card from the unit's detail panel. Both are shipped, and the inline one links
  // to the other so a click swaps between them. A plain link rather than a script, because
  // GitHub Pages serves these as static markdown and JS in a .md file would not run.
  function cardMarkup(u) {
    const has = (n) => fs.existsSync(path.join(OUT, "cards", n));
    const card = `${u.slug}.png`, info = `${u.slug}_info.png`;
    if (!has(card)) return has(info) ? `<img src="../cards/${info}" alt="${u.name}" width="164" align="right">\n\n` : "";
    const img = `<img src="../cards/${card}" alt="${u.name} unit card" width="164" align="right">`;
    if (!has(info)) return `${img}\n\n`;
    return `<a href="../cards/${info}" title="Click for the info card">${img}</a>\n\n`;
  }

  const body = `# ${u.name}

[← all units](../units.md) · [wiki index](../README.md)

${cardMarkup(u)}${u.hasName ? "" : "> _This unit has no display name in the text files, so its internal name is shown._\n\n"}${u.merc === "all" ? `> **Mercenary.** Hired from a regional pool, not recruited from a building.${u.hasName && ALREADY_MERC.test(u.rawName) ? " The mod already names it as one." : ` The mod calls it "${u.rawName || u.type}"; this wiki prefixes "Mercenary" so the roster reads unambiguously.`}\n\n` : ""}${u.merc === "mixed" ? `> **Reachable both ways.** Some entries for this unit are mercenary (\`merc …\`) and some are\n> not, so it can be hired from a pool *or* raised from a building. It is not prefixed\n> "Mercenary", because calling it a mercenary outright would be wrong.\n\n` : ""}**Class:** ${u.cls || "unknown"} · **Category:** ${u.category || "unknown"}${s.men != null ? ` · **Men per unit:** ${s.men}` : ""}

## Stats

The bar shows where this unit sits in the whole RIS roster, so a number can be read against
its peers rather than against vanilla — RIS stats run much higher than the base game's.

| | | Rank in roster |
|---|---:|---|
${stat("Attack", s.attack, "", "attack")}${stat("Charge bonus", s.charge, "", "charge")}${s.weapon ? `| Weapon | ${s.weapon} | |\n` : ""}${stat("Armour", s.armour, "", "armour")}${stat("Defence skill", s.defence, "", "defence")}${stat("Shield", s.shield, "", "shield")}${stat("Morale", s.morale, "", "morale")}${s.discipline ? `| Discipline | ${s.discipline} | |\n` : ""}${s.training ? `| Training | ${s.training} | |\n` : ""}${stat("Men per unit", s.men, "", "men")}${stat("Recruitment cost", s.cost, " dn", "cost")}${stat("Upkeep per turn", s.upkeep, " dn", "upkeep")}${stat("Turns to recruit", s.turns)}
${u.attributes.length ? `\n**Attributes:** ${u.attributes.map((a) => `\`${a}\``).join(", ")}\n` : ""}
${hireSection}${
  // A mercenary with no building route at all has nothing to say here, and printing "no
  // recruitment route was found" under a heading about recruitment reads as missing data
  // rather than as the truth — that it is hired instead. 314 of the 320 mercenary types are
  // in exactly that position, so the section is omitted for them.
  u.merc === "all" && !avail.allCore && !avail.all && !coreList.length && !aorCount ? "" : `## Who can recruit it

${avail.allCore
  ? `Every faction can raise this unit from its own buildings — it is open to \`factions { all }\` with no regional gate.`
  : coreList.length
    ? `${coreList.length === 1
        ? `A core roster unit for one faction, which can raise it anywhere it holds the right building:`
        : `A core roster unit for ${coreList.length} factions, each able to raise it anywhere they hold the right building:`}\n\n${coreList.slice(0, 40).map(factionLink).join(" · ")}${coreList.length > 40 ? `\n\n_…and ${coreList.length - 40} more._` : ""}`
    : avail.all || aorCount
      ? `No faction has this as a core unit — it is area-of-recruitment only, so it can be raised solely in provinces carrying the required hidden resource.`
      : `_No recruitment route for this unit was found in the building files._`}
${avail.all && !avail.allCore ? `\nIt is offered to \`factions { all }\` behind a regional gate, so any faction holding the right province can field it.\n` : aorCount ? `\nA further ${aorCount} faction${aorCount === 1 ? "" : "s"} can raise it regionally, in provinces with the required resource.\n` : ""}
> The exact building level and any resource requirement are listed on each faction's page.

`}${u.long || u.short
  ? `## Description\n\n${sectionise(u.long || u.short)}\n\n`
  : "> This unit has no written description in the mod yet.\n\n"}
${u.variants.length > 1 ? `## Recruitment variants

This unit is defined ${u.variants.length} times in the mod — the same troops reached by
different routes. \`aor …\` entries are area-of-recruitment versions, available in regions
matching that AOR; \`horde …\` versions belong to horde factions.

${u.variants.map((v) => `- \`${v}\``).join("\n")}
${u.statsDiffer ? `\n> **The variants do NOT all share the same stats.** The figures above are taken from\n> \`${u.type}\`; at least one other variant differs, so check in-game if the exact numbers matter.\n` : "\n_All variants share the same stats._\n"}` : `_Internal name: \`${u.type}\`_`}
`;
  fs.writeFileSync(path.join(OUT, "units", `${u.slug}.md`), body, "utf8");
}

// ── index ────────────────────────────────────────────────────────────────────
const byClass = {};
for (const u of merged) (byClass[u.cls || "unknown"] = byClass[u.cls || "unknown"] || []).push(u);

const idx = `# Units

[← wiki index](README.md)

${merged.length.toLocaleString("en-US")} distinct units, against vanilla's 261. (The mod defines ${rows.length.toLocaleString("en-US")} entries; ${(rows.length - merged.length).toLocaleString("en-US")} of those are area-of-recruitment or horde variants of a unit already listed, merged here onto one page each.) ${named.toLocaleString("en-US")} have a
display name in the text files; ${described.toLocaleString("en-US")} have a written description.

${placeholder ? `> **${placeholder.toLocaleString("en-US")} units still carry RIS's placeholder text** ("this unit needs a
> description"). Those are shown as having no description rather than printing the
> placeholder, since text that looks like content but is not is worse than an honest gap.\n` : ""}
## Mercenaries

**${mercUnits.toLocaleString("en-US")} of these units are mercenaries** — hired from a regional pool in
descr_mercenaries.txt, not recruited from a building. Every one of them is named
"Mercenary …" here so a roster cannot be misread, which groups them together in the table
below. ${mercAlreadyNamed.toLocaleString("en-US")} were already named that way by the mod; the
prefix was added to the other ${mercPrefixed.toLocaleString("en-US")}.

A mercenary is identified by its internal type beginning \`merc \`, not by the
\`mercenary_unit\` attribute — that attribute is also on all 450 area-of-recruitment entries,
so it labels 770 entries where only 320 are for hire.
${mixedDicts.length ? `\n> **${mixedDicts.length} unit${mixedDicts.length === 1 ? " is" : "s are"} defined both ways** (some entries mercenary, some not) and\n> ${mixedDicts.length === 1 ? "is" : "are"} deliberately left unprefixed: ${mixedDicts.slice(0, 20).map((d) => `\`${d}\``).join(", ")}${mixedDicts.length > 20 ? `, and ${mixedDicts.length - 20} more` : ""}.\n` : ""}
## By class

| Class | Units | of which mercenary |
|---|---:|---:|
${Object.entries(byClass).sort((a, b) => b[1].length - a[1].length).map(([c, v]) => `| ${c} | ${v.length.toLocaleString("en-US")} | ${v.filter((u) => u.merc === "all").length.toLocaleString("en-US")} |`).join("\n")}

## Full roster

| Unit | Class | Men | Attack | Defence | Morale | Cost | Upkeep | Variants |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${merged.slice().sort((a, b) => a.name.localeCompare(b.name)).map((u) => {
  const s = u.st;
  const n = (v) => (v == null ? "—" : v.toLocaleString("en-US"));
  return `| [${u.name}](units/${u.slug}.md) | ${u.cls || "—"} | ${n(s.men)} | ${n(s.attack)} | ${n(s.defence)} | ${n(s.morale)} | ${n(s.cost)} | ${n(s.upkeep)} | ${u.variants.length > 1 ? u.variants.length : ""} |`;
}).join("\n")}

## A note on the numbers

RIS rescales unit stats well above vanilla, and unevenly. Measured across both games:
attack median 8 -> 11, armour 3 -> 7, but **defence skill 3 -> 19** (p95 7 -> 30). So a
defence figure near 20 is ordinary here, not exceptional - do not read these against
vanilla intuition.

## Not here yet

**Unit cards** are on the pages where the mod ships one. 42 units have no card file
(mostly legion variants); those pages simply omit it.

**Stat comparisons against vanilla.** Worth doing, and the vanilla EDU is available to
diff against.
`;
fs.writeFileSync(path.join(OUT, "units.md"), idx, "utf8");

console.log(`${list.length.toLocaleString("en-US")} unit pages written (from ${rows.length.toLocaleString("en-US")} EDU entries)`);
console.log(`  merged away as variants: ${(rows.length - merged.length).toLocaleString("en-US")}`);
console.log(`  units whose variants disagree on stats: ${merged.filter((m) => m.statsDiffer).length.toLocaleString("en-US")}`);
console.log(`  mercenary units:          ${mercUnits.toLocaleString("en-US")} (from ${rows.filter((r) => r.isMercType).length} \`merc \` EDU entries; ${mercAlreadyNamed} already named "Mercenary…", ${mercPrefixed} prefixed here)`);
console.log(`  mixed merc/non-merc dictionaries: ${mixedDicts.length}${mixedDicts.length ? ` — LEFT UNPREFIXED: ${mixedDicts.slice(0, 20).join(", ")}${mixedDicts.length > 20 ? `, +${mixedDicts.length - 20} more` : ""}` : " (none — the prefix is unambiguous)"}`);
console.log(`  mercenary units with no pool offering them: ${merged.filter((u) => u.merc === "all" && !u.variants.some((v) => mercPools.has(String(v).toLowerCase()))).length}`);
console.log(`  with a display name:      ${named.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")}`);
console.log(`  with a real description:  ${described.toLocaleString("en-US")}`);
console.log(`  still on placeholder text:${placeholder.toLocaleString("en-US")}`);
console.log(`  distinct classes:         ${Object.keys(byClass).length}`);
