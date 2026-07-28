#!/usr/bin/env node
/**
 * One reference page per BELIEF, plus the index that lists them all.
 *
 *   node scripts/gen-ris-belief-pages.js [--ris <dir>] [--out <dir>]
 *
 * Run it AFTER gen-ris-region-pages.js, which owns wiki/belief-icons/ and writes the pip for
 * every belief the mod declares. This generator REUSES those files and converts nothing: one
 * owner per output directory is what keeps the collision check in verify-ris-wiki.js
 * meaningful. Run it BEFORE gen-ris-faction-pages.js and gen-ris-culture-pages.js, both of
 * which read religions/index.json to link the belief they print.
 *
 * A region page names the peoples who live there and a faction has a `default religion`, and
 * both were dead ends. These pages say what a belief IS and what the mod does with it.
 *
 * THE BLOCK SHAPE, AND THE TRAP IN IT. descr_beliefs.txt declares 53 beliefs, but they are not
 * all at the same indent: twelve blocks — mysian, lydian, carian, lycian, pamphylian, pisidian,
 * phrygian, paphlagonian, lycaonian, isaurian, cilician and cappadocian, the Anatolian set —
 * are written one tab deeper than the rest. A pattern anchored on a single tab finds 41 of the
 * 53 and misses exactly those twelve, every one of which is a people the map actually uses. So
 * a block is recognised by the `"religion icon"` line it CARRIES, not by its indentation, and
 * both counts are taken on every run and printed side by side, because that is what catches it.
 *
 * WHAT A BELIEF DECIDES, established rather than described:
 *
 *   1. WHERE IT IS — descr_regions.txt, through the `rel_<belief>_<tier>` tag on a region's tag
 *      line. The trailing digit is a 1-4 STRENGTH TIER, not a percentage, and it is never
 *      printed as one. What it is is checked in the file that consumes it: the same building
 *      level grants a different `religious_belief` amount for each of the four tiers, and the
 *      per-belief table on each page is that mapping read straight off the file.
 *
 *   2. WHO THE PEOPLE ARE — descr_regions.txt again, field 7, the `<people> <pct>` pairs that
 *      sum to 100. The vocabulary is nearly but not quite the same as the tag vocabulary, and
 *      where a region names a people with no belief tag of its own, or carries a belief tag for
 *      a people it does not name, the page says which.
 *
 *   3. WHO FOLLOWS IT — descr_sm_factions.txt gives all 239 faction blocks a
 *      `"default religion"`. export_descr_buildings.txt ALSO declares who follows what, as
 *      `alias faction_religion_<belief> { requires factions { … } }`. The two do not agree
 *      everywhere, and every disagreement is published on both pages rather than resolved.
 *
 *   4. WHAT THE MOD CONDITIONS ON IT — export_descr_buildings.txt. The answer includes a
 *      strong negative that a silently empty section would have hidden: **no building level and
 *      no recruitment line in the mod is gated on a belief.** Every consequence is a capability
 *      effect. That is stated with the number of levels and recruit lines that were examined.
 *
 * DISPLAY NAMES are the mod's own. Each block declares its own `"name"` key — `ITALIC_LABEL` —
 * and that key is looked up in text/expanded_bi.txt (UTF-16LE). One key spells its separator
 * with a hyphen where the token uses an underscore, hence the second attempt. Any belief with
 * no entry prints its token.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const anchor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = (n) => Number(n).toLocaleString("en-US");
const uniq = (a) => [...new Set(a)];
const fold = (summary, lines) => `<details>\n<summary>${summary}</summary>\n\n${lines.join("\n")}\n\n</details>`;
const cell = (s) => String(s).replace(/\|/g, "\\|");

const L = require(path.join(__dirname, "lib", "edbRecruit.js"));
const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));

const EDB_TXT = rd("export_descr_buildings.txt");
if (!EDB_TXT) { console.error("export_descr_buildings.txt not found"); process.exit(2); }
const ALIASES = L.parseAliases(EDB_TXT);
const EDB = L.parseEdb(EDB_TXT);
const TAG_USAGE = L.tagUsage(EDB, ALIASES);
const LEVEL_BLOCKS = EDB.chains.reduce((a, c) => a + Object.keys(c.levels).length, 0);

// ── display names ────────────────────────────────────────────────────────────
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return map;
}
const BI_NAMES = loadText("expanded_bi.txt");
const BUILDING_NAMES = loadText("export_buildings.txt");
const REGION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "imperial_campaign_regions_and_settlement_names.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) out[m[1].trim()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return out;
})();
const FACTION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "campaign_descriptions.txt"), "utf16le");
    for (const m of t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_TITLE\}([^\r\n]*)/g)) out[m[1].toLowerCase()] = m[2].trim();
  } catch { /* tokens */ }
  return out;
})();

const NO_PAGE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
const npName = (f) => BI_NAMES[String(f).toLowerCase()] || String(f).replace(/_/g, " ");
const facName = (f) => FACTION_NAMES[String(f).toLowerCase()] || npName(f);

const dirNames = (sub, ext) => {
  try { return new Set(fs.readdirSync(path.join(OUT, sub)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length))); }
  catch { return new Set(); }
};
const factionPages = dirNames("factions", ".md");
const regionPages = dirNames("regions", ".md");
const buildingPages = dirNames("buildings", ".md");
const symbolFiles = dirNames("symbols", ".png");
// Written by gen-ris-region-pages.js, which owns the directory. Reused, never re-converted.
const beliefIcons = dirNames("belief-icons", ".png");

const facLink = (f) => (NO_PAGE.has(String(f).toLowerCase())
  ? `[${npName(f)}](../factions/non-playable.md)`
  : factionPages.has(String(f)) ? `[${facName(f)}](../factions/${f}.md)` : `**${facName(f)}**`);
const regionName = (r) => REGION_NAMES[r] || String(r).replace(/_/g, " ");
const regionLink = (r) => (regionPages.has(r) ? `[${regionName(r)}](../regions/${encodeURIComponent(r)}.md)` : regionName(r));
let levelNameMisses = 0;
const levelName = (level) => {
  const n = BUILDING_NAMES[String(level).toLowerCase()];
  if (!n) levelNameMisses++;
  return n || String(level).replace(/_/g, " ");
};
const levelLink = (chain, level) => {
  const p = String(chain).toLowerCase();
  const label = `**${levelName(level)}**`;
  return buildingPages.has(p) ? `[${label}](../buildings/${p}.md)` : label;
};

// ── descr_beliefs.txt ────────────────────────────────────────────────────────
/**
 * A belief block, recognised by the `"religion icon"` line it carries rather than by its
 * indentation — see the header. Every field the file declares is kept, because "all 53 declare
 * the same value" is itself a finding and cannot be said without reading all 53.
 */
function loadBeliefs(txt) {
  const out = {};
  const order = [];
  let cur = null, inMultipliers = false;
  for (const raw of String(txt || "").split(L.SPLIT_EOL)) {
    const line = raw.replace(/;;.*$/, "").replace(/\r$/, "");
    // A key on its own line, at ANY indent, with nothing after the colon. The character class
    // has to allow a SPACE: `"unrest multipliers"` is one of these and a `[a-z0-9_]` class
    // silently misses it, which leaves the flag below permanently false and loses both
    // multipliers from all 53 beliefs — with no error and no empty section to notice.
    let m = /^\s+"([a-z0-9_ \-]+)"\s*:\s*$/.exec(line);
    if (m) {
      if (m[1] === "unrest multipliers") { inMultipliers = true; continue; }
      cur = { tok: m[1].toLowerCase() };
      inMultipliers = false;
      continue;
    }
    if (!cur) continue;
    // Fields are written onto the CANDIDATE, not onto the registered record, because half of
    // them — `trait` and `unrest icon` — are declared ABOVE the `religion icon` line that
    // confirms the block. Registering first and assigning afterwards lost every one of them.
    m = /"religion icon"\s*:\s*"([^"]+)"/.exec(line);
    if (m) { cur.icon = m[1]; if (!out[cur.tok]) order.push(cur.tok); out[cur.tok] = cur; continue; }
    m = /"unrest icon"\s*:\s*"([^"]+)"/.exec(line); if (m) { cur.unrestIcon = m[1]; continue; }
    m = /"info button"\s*:\s*"([^"]+)"/.exec(line); if (m) { cur.infoButton = m[1]; continue; }
    m = /"name"\s*:\s*"([^"]+)"/.exec(line); if (m && !cur.nameKey) { cur.nameKey = m[1].toLowerCase(); continue; }
    m = /"trait"\s*:\s*"([^"]+)"/.exec(line); if (m) { cur.trait = m[1]; continue; }
    m = /"unrest tooltip"\s*:\s*"([^"]+)"/.exec(line); if (m) { cur.unrestKey = m[1].toLowerCase(); continue; }
    m = /"group"\s*:\s*"([a-z0-9_]+)"/.exec(line); if (m) { cur.group = m[1].toLowerCase(); continue; }
    m = /"hide at zero"\s*:\s*(true|false)/.exec(line); if (m) { cur.hideAtZero = m[1] === "true"; continue; }
    if (inMultipliers) {
      m = /"(heretics|heathens)"\s*:\s*(-?[\d.]+)/.exec(line);
      if (m) { (cur.mult = cur.mult || {})[m[1]] = parseFloat(m[2]); continue; }
    }
  }
  return { beliefs: out, order };
}
const BELIEF_TXT = rd("descr_beliefs.txt");
if (!BELIEF_TXT) { console.error("descr_beliefs.txt not found"); process.exit(2); }
const { beliefs: BELIEFS, order: BELIEF_ORDER } = loadBeliefs(BELIEF_TXT);
if (!BELIEF_ORDER.length) { console.error("no beliefs parsed from descr_beliefs.txt"); process.exit(2); }

// Three independent counts of the same thing. The first is what a single-tab pattern would
// have found, kept deliberately so the trap stays visible in the run output; the other two are
// flat patterns over the file text that no block walk can influence.
const SINGLE_TAB_BLOCKS = (BELIEF_TXT.match(/^\t"[a-z0-9_\-]+"\s*:\s*\r?$/gm) || []).length;
const RAW_ICON_LINES = (BELIEF_TXT.match(/"religion icon"\s*:/g) || []).length;
const RAW_NAME_LINES = (BELIEF_TXT.match(/"name"\s*:/g) || []).length;

const nameVia = { declared: new Set(), convention: new Set(), none: new Set() };
function beliefName(tok) {
  const t = String(tok).toLowerCase();
  const key = BELIEFS[t] && BELIEFS[t].nameKey;
  if (key && BI_NAMES[key]) { nameVia.declared.add(t); return BI_NAMES[key]; }
  const hit = BI_NAMES[`${t}_label`] || BI_NAMES[`${t.replace(/_/g, "-")}_label`];
  if (hit) { nameVia.convention.add(t); return hit; }
  nameVia.none.add(t);
  return null;
}
const bName = (tok) => beliefName(tok) || String(tok);
// A GROUP has no name of its own anywhere in the mod: descr_beliefs declares the token and no
// text file localises it. Twenty-one of the twenty-two group tokens are also belief tokens, so
// those borrow the belief's own declared name; `hellenic` is not, and prints as the token. No
// group name is invented, and the index page says which is which.
const groupNamed = { viaBelief: new Set(), token: new Set() };
function groupName(g) {
  if (!g) return null;
  const t = String(g).toLowerCase();
  if (BELIEFS[t] && beliefName(t)) { groupNamed.viaBelief.add(t); return beliefName(t); }
  groupNamed.token.add(t);
  return t;
}
const BELIEF_ICON_PX = 16;
const pip = (tok) => (beliefIcons.has(tok)
  ? `<img src="../belief-icons/${tok}.png" alt="" width="${BELIEF_ICON_PX}" height="${BELIEF_ICON_PX}" style="vertical-align:text-bottom"> ` : "");
const pipRel = (tok, rel) => (beliefIcons.has(tok)
  ? `<img src="${rel}belief-icons/${tok}.png" alt="" width="${BELIEF_ICON_PX}" height="${BELIEF_ICON_PX}" style="vertical-align:text-bottom"> ` : "");

// ── descr_regions ────────────────────────────────────────────────────────────
// Same block walk the region generator uses, indexed off the RGB line because it is the only
// line whose shape is unmistakable and a stray comment inside a block shifts everything else.
function loadRegions() {
  const lines = (rd("world", "maps", "base", "descr_regions.txt") || "").split(L.SPLIT_EOL);
  const out = [];
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
    const tags = (body[rgbAt + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    // "dorian 70 italic 30" -> pairs. Returns [] when the field is not a sequence of
    // name/number pairs, so an unparseable line is reported rather than guessed at.
    const eth = [];
    const parts = String(body[rgbAt + 4] || "").trim().split(/\s+/);
    if (parts.length >= 2 && parts.length % 2 === 0) {
      for (let k = 0; k < parts.length - 1; k += 2) {
        const pct = parseInt(parts[k + 1], 10);
        if (isNaN(pct) || !/^[a-z_]+$/i.test(parts[k])) { eth.length = 0; break; }
        eth.push({ name: parts[k].toLowerCase(), pct });
      }
    }
    out.push({ region: lines[i].trim(), owner: body[1], tags, eth });
  }
  return out;
}
const REGIONS = loadRegions();
if (!REGIONS.length) { console.error("no regions parsed from descr_regions.txt"); process.exit(2); }

const REL_TAG = /^rel_([a-z_]+)_(\d)$/i;
const tierOf = new Map();          // belief -> Map(region -> tier)
const peopleIn = new Map();        // belief -> [{region, pct}]
let relTagsSeen = 0, oddRelTags = [];
for (const r of REGIONS) {
  for (const t of r.tags) {
    if (!/^rel_/i.test(t)) continue;
    relTagsSeen++;
    const m = REL_TAG.exec(t);
    if (!m) { oddRelTags.push(`${r.region}: ${t}`); continue; }
    const b = m[1].toLowerCase();
    if (!tierOf.has(b)) tierOf.set(b, new Map());
    tierOf.get(b).set(r.region, parseInt(m[2], 10));
  }
  for (const e of r.eth) {
    if (!peopleIn.has(e.name)) peopleIn.set(e.name, []);
    peopleIn.get(e.name).push({ region: r.region, pct: e.pct });
  }
}
// Second, independent count of the same tags: a flat pattern over the whole file with no block
// structure involved at all.
const RAW_REL_TAGS = ((rd("world", "maps", "base", "descr_regions.txt") || "").match(/\brel_[a-z_]+_\d\b/g) || []).length;

// ── who follows it, from two files that do not agree ─────────────────────────
const FACTIONS = (() => {
  const out = {};
  let cur = null;
  for (const raw of (rd("descr_sm_factions.txt") || "").split(L.SPLIT_EOL)) {
    const line = raw.replace(/;.*$/, "");
    let m = /^\t"([a-z0-9_]+)"\s*:/.exec(line);
    if (m) { cur = m[1].toLowerCase(); out[cur] = out[cur] || { faction: cur }; continue; }
    if (!cur) continue;
    m = /"culture"\s*:\s*"([a-z_]+)"/.exec(line); if (m) { out[cur].culture = m[1].toLowerCase(); continue; }
    m = /"default religion"\s*:\s*"([a-z_]+)"/.exec(line); if (m) { out[cur].religion = m[1].toLowerCase(); continue; }
  }
  return out;
})();
const RAW_RELIGION_LINES = ((rd("descr_sm_factions.txt") || "").match(/"default religion"\s*:\s*"[a-z_]+"/g) || []).length;
const factionsOf = (tok) => Object.values(FACTIONS).filter((f) => f.religion === tok).map((f) => f.faction).sort();
const factionsWithNoReligion = Object.values(FACTIONS).filter((f) => !f.religion).map((f) => f.faction);

// The buildings file's OWN answer to the same question. `alias faction_religion_<belief> {
// requires factions { … } }` is what every temple and government level actually tests, so where
// it and descr_sm_factions disagree the game does one thing and the faction sheet says another.
const CULTURE_TOKENS = (() => {
  const out = new Set();
  for (const m of (rd("descr_cultures.txt") || "").matchAll(/^\t"([a-z0-9_]+)"\s*:\s*$/gm)) out.add(m[1].toLowerCase());
  return out;
})();
const ALIAS_FOLLOWERS = (() => {
  const out = {};
  for (const [name, body] of Object.entries(ALIASES)) {
    const m = /^faction_religion_([a-z0-9_]+)$/.exec(name);
    if (!m || m[1].startsWith("group_")) continue;
    const fm = /factions\s*\{([^}]*)\}/i.exec(body);
    if (!fm) continue;
    out[m[1]] = fm[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return out;
})();
const GROUP_ALIASES = Object.keys(ALIASES).filter((n) => /^faction_religion_group_/.test(n))
  .map((n) => n.replace(/^faction_religion_group_/, ""));

// ── what the mod conditions on it ────────────────────────────────────────────
// Two different questions, kept apart because conflating them is what makes a religion system
// unreadable:
//   what GENERATES the belief — `religious_belief <tok> N requires …` lines, wherever they are
//   what the belief GATES     — clauses that test `hidden_resource rel_<tok>_<tier>`, reached
//                               directly or through the `religion_present_<tok>` alias
const GENERATORS = new Map();      // belief -> [effect]
for (const e of EDB.effects) {
  if (e.effect !== "religious_belief" || !e.subject) continue;
  const b = e.subject.toLowerCase();
  if (!GENERATORS.has(b)) GENERATORS.set(b, []);
  GENERATORS.get(b).push(e);
}
const TIERS = [1, 2, 3, 4];
function gatedBy(tok) {
  const perTier = new Map();       // tier -> usage
  for (const t of TIERS) perTier.set(t, TAG_USAGE.get(`rel_${tok}_${t}`) || null);
  return perTier;
}
// The strong negative, measured once for every belief rather than assumed from one: nothing in
// the mod gates a building level or a recruitment line on a belief.
let gatedLevels = 0, gatedRecruits = 0;
for (const tok of BELIEF_ORDER) {
  for (const t of TIERS) {
    const u = TAG_USAGE.get(`rel_${tok}_${t}`);
    if (!u) continue;
    gatedLevels += u.levels.length + u.blockedLevels.length;
    gatedRecruits += u.recruits.length + u.blockedRecruits.length;
  }
}

// ── the campaign start ───────────────────────────────────────────────────────
const STRAT_PATH = path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
const strat = gv.parseStrat(STRAT_PATH) || {};
const heldByFaction = new Map();
let heldTotal = 0;
for (const [fac, v] of Object.entries(strat)) {
  heldByFaction.set(fac, (v.settlements || []).length);
  heldTotal += (v.settlements || []).length;
}

// Where the culture pages are, so a follower's culture can be linked.
let CULTURE_INDEX = {};
try { CULTURE_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "cultures", "index.json"), "utf8")); } catch { /* run gen-ris-culture-pages.js first */ }
let cultureLinked = 0;
const cultureRef = (tok) => {
  const e = CULTURE_INDEX[String(tok).toLowerCase()];
  if (!e) return `\`${tok}\``;
  cultureLinked++;
  return `[${e.name}](../cultures/${e.page})`;
};

// ── page assembly ────────────────────────────────────────────────────────────
const HEAD = (title) => `# ${title}\n\n[← all beliefs](../religions.md) · [all cultures](../cultures.md) · [all regions](../regions.md) · [wiki index](../README.md)\n`;

const PROVENANCE = [
  "<details>",
  "<summary>Where these answers come from</summary>",
  "",
  "descr_beliefs.txt declares the belief, its pip and its localised name. **Where it is** is the "
  + "`rel_<belief>_<tier>` tag on a region's tag line in descr_regions.txt — the trailing digit "
  + "is a 1-4 strength tier and never a percentage. **Who the people are** is that same file's "
  + "ancestry field, whose shares do sum to 100. **Who follows it** is stated twice, by "
  + "descr_sm_factions.txt's `default religion` and by export_descr_buildings.txt's "
  + "`faction_religion_<belief>` alias, and where the two disagree both are shown. **What the "
  + "mod does with it** is read off export_descr_buildings.txt, with the clauses that GENERATE "
  + "the belief kept apart from the clauses the belief GATES.",
  "",
  "</details>",
].join("\n");

const TIER_NOTE = "What matters is whether it is the **largest** belief in the settlement or "
  + "merely present alongside a larger one. The file records a finer number behind that, and it "
  + "is not a percentage — the one place it shows is how much `religious_belief` a building "
  + "generates, which is the table further down.";

const FOLD_AT = 12;
const maybeFold = (summary, n, table) => (n > FOLD_AT ? fold(summary, [table]) : table);

function beliefFacts(tok) {
  const b = BELIEFS[tok];
  const regions = tierOf.get(tok) || new Map();
  const byTier = new Map(TIERS.map((t) => [t, []]));
  for (const [r, t] of regions) (byTier.get(t) || []).push(r);
  const people = peopleIn.get(tok) || [];
  const facs = factionsOf(tok);
  const alias = ALIAS_FOLLOWERS[tok] || null;
  return {
    tok, b, name: bName(tok), group: b.group || null,
    regions, byTier, people, facs, alias,
    generators: GENERATORS.get(tok) || [],
    gated: gatedBy(tok),
  };
}

function beliefPage(f, all) {
  const { tok, b } = f;
  const name = f.name;
  const nRegions = f.regions.size;
  const siblings = all.filter((o) => o.group && o.group === f.group && o.tok !== tok);

  // ── where it is ──
  // TWO STATES, not four. The file records a 1-4 number, but what the game acts on is whether
  // this is the largest belief in the settlement — so that is what the page says: the majority
  // belief, or present alongside a larger one. Printing "3 of 4" invited a reader to weigh a
  // difference that does not exist for them, and "4 of 4" made the one thing that does matter
  // look like a coincidence of scale.
  //
  // The numbers are not discarded. They still key the grants further down the page, where they
  // decide how much a building level adds — that is the one place the finer value shows up, and
  // it is labelled there.
  // Named apart from the ancestry `majority` further down — the two are different measurements
  // of different fields, and sharing a name here was a syntax error that said so out loud.
  const majorityIn = f.byTier.get(4) || [];
  const presentIn = TIERS.filter((t) => t !== 4).flatMap((t) => f.byTier.get(t) || []);
  const pct = (n) => (nRegions ? `${((n / nRegions) * 100).toFixed(0)}%` : "—");
  const tierRows = [
    `| The majority belief | ${majorityIn.length || "—"} | ${pct(majorityIn.length)} |`,
    `| Present, not the largest | ${presentIn.length || "—"} | ${pct(presentIn.length)} |`,
  ];
  const regionFolds = [["The majority belief", majorityIn], ["Present, not the largest", presentIn]]
    .filter(([, list]) => list.length)
    .map(([label, list]) => fold(
      `${label} — ${list.length} ${list.length === 1 ? "region" : "regions"}`,
      [list.slice().sort((a, c) => regionName(a).localeCompare(regionName(c))).map(regionLink).join(" · ")]));

  // ── the people ──
  // The belief token is also a people token in the ancestry field, and the two vocabularies do
  // not line up region for region. Both directions of the mismatch are counted and named,
  // because either one alone reads as a parsing failure.
  const peopleRegions = new Set(f.people.map((p) => p.region));
  const tagRegions = new Set(f.regions.keys());
  const peopleNoTag = [...peopleRegions].filter((r) => !tagRegions.has(r));
  const tagNoPeople = [...tagRegions].filter((r) => !peopleRegions.has(r));
  const majority = f.people.filter((p) => p.pct >= 50).length;
  const totalShare = f.people.reduce((a, p) => a + p.pct, 0);

  // ── followers ──
  const facRows = f.facs
    .map((x) => ({ f: x, n: heldByFaction.get(x) || 0, culture: (FACTIONS[x] || {}).culture || null }))
    .sort((a, c) => c.n - a.n || facName(a.f).localeCompare(facName(c.f)));
  const heldByFollowers = facRows.reduce((a, r) => a + r.n, 0);
  const aliasOnly = f.alias ? f.alias.filter((x) => !f.facs.includes(x) && !CULTURE_TOKENS.has(x)) : [];
  const aliasCultures = f.alias ? f.alias.filter((x) => CULTURE_TOKENS.has(x)) : [];
  const defaultOnly = f.alias ? f.facs.filter((x) => !f.alias.includes(x)) : [];

  // ── what generates it ──
  // One row per building level, one column per tier, which is the shape the file is actually
  // in: the same level grants a different amount at each of the four tiers.
  const genByLevel = new Map();
  for (const t of TIERS) {
    const u = f.gated.get(t);
    if (!u) continue;
    for (const e of u.effects) {
      if (e.effect !== "religious_belief" || String(e.subject || "").toLowerCase() !== tok) continue;
      const k = `${e.chain}|${e.level}`;
      if (!genByLevel.has(k)) genByLevel.set(k, { chain: e.chain, level: e.level, byTier: new Map() });
      const cur = genByLevel.get(k).byTier.get(t);
      genByLevel.get(k).byTier.set(t, cur == null ? e.amount : Math.max(cur, e.amount));
    }
  }
  // The one table where the finer number is the answer, so it is the one place it is printed —
  // and the top of it is named rather than numbered, to match the rest of the page.
  const grantCol = (t) => (t === 4 ? "majority" : String(t));
  const tierTable = genByLevel.size
    ? [`| Where | ${TIERS.map((t) => grantCol(t)).join(" | ")} |`,
      `|---|${TIERS.map(() => "---:").join("|")}|`,
      ...[...genByLevel.values()].sort((a, c) => levelName(a.level).localeCompare(levelName(c.level)))
        .map((g) => `| ${levelLink(g.chain, g.level)} | ${TIERS.map((t) => (g.byTier.get(t) == null ? "—" : `+${g.byTier.get(t)}`)).join(" | ")} |`)].join("\n")
    : null;

  // Everything that grants this belief, whatever it is conditioned on — the tier table above
  // only covers the lines a tier decides, and the temples do not work that way.
  const genOther = f.generators.filter((e) => !/rel_[a-z_]+_\d/.test(e.requires || ""));
  const genByChain = new Map();
  for (const e of genOther) {
    if (!genByChain.has(e.chain)) genByChain.set(e.chain, []);
    genByChain.get(e.chain).push(e);
  }
  const genOtherRows = [...genByChain.entries()]
    .sort((a, c) => c[1].length - a[1].length || a[0].localeCompare(c[0]))
    .map(([chain, list]) => {
      const amounts = uniq(list.map((e) => e.amount)).sort((a, c) => a - c);
      const levels = uniq(list.map((e) => `${e.chain}|${e.level}`)).map((s) => { const [ch, lv] = s.split("|"); return levelLink(ch, lv); });
      return `| ${levels.join(", ")} | ${list.length} | ${amounts.map((a) => `+${a}`).join(", ")} |`;
    });

  // ── what it withholds ──
  const withheld = new Map();
  for (const t of TIERS) {
    const u = f.gated.get(t);
    if (!u) continue;
    for (const e of u.blockedEffects) {
      const k = `${e.chain}|${e.level}|${e.effect}|${e.subject || ""}|${e.amount}`;
      withheld.set(k, e);
    }
  }
  const withheldRows = [...withheld.values()]
    .sort((a, c) => levelName(a.level).localeCompare(levelName(c.level)))
    .map((e) => `| ${levelLink(e.chain, e.level)} | ${cell(`${e.subject ? bName(e.subject) : ""} belief +${e.amount}`.trim())} |`);

  const glance = [
    `**${nRegions}** of ${num(REGIONS.length)} regions`,
    f.people.length ? `named as a people in **${f.people.length}**` : null,
    `**${f.facs.length}** faction${f.facs.length === 1 ? "" : "s"} default to it`,
  ].filter(Boolean).join(" · ");

  const unrestText = b.unrestKey ? BI_NAMES[b.unrestKey] : null;

  const body = `${HEAD(`${pip(tok)}${name}`)}
Internal token \`${tok}\`${b.group ? `, in the ${groupName(b.group)} group` : ""}. ${glance}

${PROVENANCE}

## Where it is on the map

${nRegions
    ? `**${nRegions}** of the ${num(REGIONS.length)} regions carry a \`rel_${tok}_…\` tag — **${((nRegions / REGIONS.length) * 100).toFixed(1)}%** of the map. ${TIER_NOTE}

| Strength | Regions | Share of its regions |
|---|---:|---:|
${tierRows.join("\n")}

${regionFolds.join("\n\n")}`
    : `_No region on the map carries a \`rel_${tok}_…\` tag. All ${num(REGIONS.length)} region blocks in descr_regions.txt were read, and ${num(relTagsSeen)} belief tags found on them._`}

## The people it belongs to

${f.people.length
    ? `descr_regions.txt names **${name}** as a people living in **${f.people.length}** ${f.people.length === 1 ? "region" : "regions"}, ${majority} of ${f.people.length === 1 ? "which" : "them"} as the majority. Those shares come from the region's own ancestry field, which sums to 100 — they are a different measurement from the strength tier above and are not comparable with it.

${maybeFold(`Where its people live (${f.people.length})`, f.people.length,
      `| Region | Share |\n|---|---:|\n${f.people.slice().sort((a, c) => c.pct - a.pct || regionName(a.region).localeCompare(regionName(c.region))).map((p) => `| ${regionLink(p.region)} | ${p.pct}% |`).join("\n")}`)}

${peopleNoTag.length || tagNoPeople.length
      ? `The two vocabularies do not line up exactly. **${peopleNoTag.length}** ${peopleNoTag.length === 1 ? "region names this people but carries no belief tag for it" : "regions name this people but carry no belief tag for it"}${peopleNoTag.length ? ` — ${peopleNoTag.slice(0, 12).map(regionLink).join(", ")}${peopleNoTag.length > 12 ? `, and ${peopleNoTag.length - 12} more` : ""}` : ""}. **${tagNoPeople.length}** ${tagNoPeople.length === 1 ? "carries the tag without naming the people" : "carry the tag without naming the people"}${tagNoPeople.length ? ` — ${tagNoPeople.slice(0, 12).map(regionLink).join(", ")}${tagNoPeople.length > 12 ? `, and ${tagNoPeople.length - 12} more` : ""}` : ""}. Which of the two the mod means as authoritative is **not determined**; both are shown.`
      : "Every region that names this people also carries its belief tag, and every region that carries the tag names the people."}`
    : `_No region's ancestry field names \`${tok}\` as a people. All ${num(REGIONS.length)} ancestry fields were read${nRegions ? `, though ${nRegions} ${nRegions === 1 ? "region carries" : "regions carry"} the belief tag` : ""}._`}

## Who follows it

${f.facs.length
    ? `**${f.facs.length}** of the ${num(Object.keys(FACTIONS).length)} factions in descr_sm_factions.txt carry \`"default religion": "${tok}"\`. Between them they hold **${num(heldByFollowers)}** of the ${num(heldTotal)} settlements the campaign file places.

${maybeFold(`The ${f.facs.length} factions`, f.facs.length,
      `| Faction | Culture | Provinces |\n|---|---|---:|\n${facRows.map((r) => `| ${symbolFiles.has(r.f) ? `<img src="../symbols/${r.f}.png" alt="" width="24" height="24" style="vertical-align:middle"> ` : ""}${facLink(r.f)} | ${r.culture ? cultureRef(r.culture) : "_not determined_"} | ${r.n || "—"} |`).join("\n")}`)}`
    : `_No faction states this as its default religion. All ${num(Object.keys(FACTIONS).length)} faction blocks were read and ${num(RAW_RELIGION_LINES)} \`default religion\` lines found._`}

${f.alias
    ? `export_descr_buildings.txt answers the same question separately, with \`alias faction_religion_${tok}\`, and that alias is what the temples and government levels actually test. It names **${f.alias.length}** ${f.alias.length === 1 ? "entry" : "entries"}${aliasCultures.length ? `, ${aliasCultures.length} of which ${aliasCultures.length === 1 ? "is a culture rather than a faction" : "are cultures rather than factions"} (${aliasCultures.map(cultureRef).join(", ")})` : ""}.

${aliasOnly.length || defaultOnly.length
      ? `**The two files disagree, and this page does not resolve it.**${aliasOnly.length ? ` The alias names ${aliasOnly.map((x) => facLink(x)).join(", ")}, ${aliasOnly.length === 1 ? "whose faction block gives a different default religion" : "whose faction blocks give a different default religion"}.` : ""}${defaultOnly.length ? ` ${defaultOnly.map((x) => facLink(x)).join(", ")} ${defaultOnly.length === 1 ? "declares" : "declare"} this as ${defaultOnly.length === 1 ? "its" : "their"} default religion but ${defaultOnly.length === 1 ? "is" : "are"} not in the alias, so the buildings file will not treat ${defaultOnly.length === 1 ? "it" : "them"} as ${name}.` : ""}`
      : "The two agree exactly on who follows this belief."}`
    : `_export_descr_buildings.txt declares no \`faction_religion_${tok}\` alias, so nothing in the buildings file can test for a faction being ${name}. ${Object.keys(ALIAS_FOLLOWERS).length} such aliases exist for the ${BELIEF_ORDER.length} beliefs._`}

## What builds it

${tierTable
    ? `These building levels generate the belief in a region that already carries its tag, and the amount is what the tier decides. This is what the 1-4 tier is *for*.

${tierTable}

${withheldRows.length ? `\n${withheldRows.length} further ${withheldRows.length === 1 ? "grant is" : "grants are"} made only where the belief is **not** already present — that is the conversion path, and it stops once the belief is there.\n\n| Where | What |\n|---|---|\n${withheldRows.join("\n")}` : ""}`
    : `_No building level scales anything on this belief's strength tier. All ${num(EDB.effects.length)} conditional effect lines in export_descr_buildings.txt were checked against \`rel_${tok}_1\` through \`rel_${tok}_4\`._`}

${genOtherRows.length
    ? `### Spread by conversion — ${genOther.length} lines

Beyond the tier table, **${genOther.length}** further \`religious_belief ${tok}\` ${genOther.length === 1 ? "line grants" : "lines grant"} it on conditions that are not about the tier — who owns the settlement, what government it has, whether the belief is present at all. These are the conversion and temple rules.

| Where | Lines | Amounts |
|---|---:|---|
${genOtherRows.join("\n")}`
    : `### Spread by conversion — none

_Nothing outside the tier table grants this belief. All ${num(EDB.effects.length)} conditional effect lines were checked for a \`religious_belief ${tok}\` grant._`}

## What it gates

_**Nothing.** No building level and no recruitment line in the mod is conditioned on a belief:
all ${num(LEVEL_BLOCKS)} building level blocks and all ${num(EDB.recruits.length)} \`recruit\` lines were checked against every
\`rel_<belief>_<tier>\` token, and **${gatedLevels}** levels and **${gatedRecruits}** recruit lines came back. A belief is a
number a settlement carries, not a key that opens anything._

## Unrest and identity

| | |
|---|---|
| Group | ${b.group ? `${groupName(b.group)} (\`${b.group}\`)${GROUP_ALIASES.includes(b.group) ? ` — the buildings file tests this group directly, with \`faction_religion_group_${b.group}\`` : ""}` : "_not determined_"} |
| Character trait | ${b.trait ? `\`${b.trait}\`` : "_not determined_"} |
| Unrest against its own group | ${b.mult && b.mult.heretics != null ? `**${b.mult.heretics}**` : "_not determined_"} |
| Unrest against other groups | ${b.mult && b.mult.heathens != null ? `**${b.mult.heathens}**` : "_not determined_"} |
| Hidden at zero presence | ${b.hideAtZero == null ? "_not determined_" : (b.hideAtZero ? "yes" : "no")} |
| Unrest message | ${unrestText ? `“${unrestText}”` : (b.unrestKey ? `\`${b.unrestKey}\` — no entry in the mod's text files` : "_not determined_")} |

${(() => {
    const her = all.filter((o) => o.b.mult && o.b.mult.heretics === (b.mult || {}).heretics).length;
    const hea = all.filter((o) => o.b.mult && o.b.mult.heathens === (b.mult || {}).heathens).length;
    if (her === all.length && hea === all.length && (b.mult || {}).heretics === 0 && (b.mult || {}).heathens === 0) {
      return `Every one of the ${all.length} beliefs RIS declares sets both multipliers to **0**. No belief in this mod creates unrest against another, whether they share a group or not — the religious tension of the base game is switched off across the board, and what the belief system is used for instead is the numbers above.`;
    }
    return `${her} of the ${all.length} beliefs share this heretic multiplier and ${hea} share this heathen one.`;
  })()}

## Its group

${f.group
    ? (siblings.length
      ? `The **${groupName(f.group)}** group (\`${f.group}\`) holds **${siblings.length + 1}** beliefs. The others are ${siblings.slice().sort((a, c) => a.name.localeCompare(c.name)).map((o) => `${pip(o.tok)}[${o.name}](${o.tok}.md)`).join(", ")}.\n\nA group has no name of its own in the mod — descr_beliefs.txt declares the token \`${f.group}\` and no text file localises it. ${BELIEFS[f.group] ? `The name above is the belief of that same token, which is the mod's own.` : `No belief carries that token either, so the token is printed as it stands.`}`
      : `The **${groupName(f.group)}** group (\`${f.group}\`) holds this belief alone — no other belief in descr_beliefs.txt names it.`)
    : "_This belief declares no group._"}
`;
  fs.mkdirSync(path.join(OUT, "religions"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "religions", `${tok}.md`), body, "utf8");
  return f;
}

const FACTS = BELIEF_ORDER.map(beliefFacts);
FACTS.forEach((f) => beliefPage(f, FACTS));

// ── the anchor index ─────────────────────────────────────────────────────────
const INDEX = {};
for (const f of FACTS) {
  INDEX[f.tok] = {
    page: `${f.tok}.md`, name: f.name, anchor: anchor(f.name), group: f.group || null,
    icon: beliefIcons.has(f.tok) ? `belief-icons/${f.tok}.png` : null,
  };
}
fs.mkdirSync(path.join(OUT, "religions"), { recursive: true });
fs.writeFileSync(path.join(OUT, "religions", "index.json"), JSON.stringify(INDEX, null, 1), "utf8");

// ── the index page ───────────────────────────────────────────────────────────
const byGroup = new Map();
for (const f of FACTS) {
  const g = f.group || "";
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g).push(f);
}
const groups = [...byGroup.entries()]
  .map(([g, list]) => ({ g, list: list.slice().sort((a, b) => b.regions.size - a.regions.size || a.name.localeCompare(b.name)) }))
  .sort((a, b) => b.list.length - a.list.length || a.g.localeCompare(b.g));

const onNoRegion = FACTS.filter((f) => !f.regions.size);
const onNoFaction = FACTS.filter((f) => !f.facs.length);
const totalTagged = FACTS.reduce((a, f) => a + f.regions.size, 0);

// ### and not ##: the viewer boxes every H2 into its own card, and 22 sections of the same
// shape become 22 windows stacked down the page. The same decision, for the same reason, as the
// culture and faction indexes.
const groupSections = groups.map(({ g, list }) => {
  // Nothing in the heading but plain words: its anchor is slugged from its text, and GitHub,
  // the local viewer and verify-ris-wiki.js do not agree on what backticks or link syntax
  // inside a heading slug to.
  const head = g
    ? `### ${groupName(g)} group · ${list.length} belief${list.length === 1 ? "" : "s"} · ${list.reduce((a, f) => a + f.regions.size, 0)} regions`
    : `### Group not determined · ${list.length} belief${list.length === 1 ? "" : "s"}`;
  const rows = list.map((f) => `| ${pipRel(f.tok, "")}[${f.name}](religions/${f.tok}.md) | ${f.regions.size || "—"} | ${(f.byTier.get(4) || []).length || "—"} | ${f.people.length || "—"} | ${f.facs.length || "—"} |`).join("\n");
  // "Its people live in", not "Named as a people". The column counts regions whose ANCESTRY
  // field names this token as one of the peoples living there — a different field from the
  // belief tag, and one that answers a different question. The old heading named the mechanism
  // and left a reader to work out what it was counting.
  return `${head}\n\n| Belief | Regions | Majority | Its people live in | Factions |\n|---|---:|---:|---:|---:|\n${rows}`;
}).join("\n\n");

const indexBody = `# Beliefs

[← all cultures](cultures.md) · [all regions](regions.md) · [all settlements](settlements.md) · [wiki index](README.md)

RIS replaces the base game's handful of religions with **${BELIEF_ORDER.length}** local beliefs — one per people, near
enough — and spreads them across the map as a **strength tier** rather than a share. Every one
has its own page: where it is, who its people are, who follows it, and what the mod does with it.

**${FACTS.filter((f) => f.regions.size).length}** of the ${BELIEF_ORDER.length} are on the map at the campaign start, carried between them by ${num(totalTagged)}
region tags across ${num(REGIONS.length)} regions. ${onNoRegion.length ? `The other ${onNoRegion.length} — ${onNoRegion.map((f) => `**${f.name}**`).join(" and ")} — ${onNoRegion.length === 1 ? "is" : "are"} declared but on no region: ${onNoRegion.length === 1 ? "it is" : "they are"} the umbrella ${onNoRegion.length === 1 ? "entry" : "entries"} the finer-grained beliefs sit under.` : ""}

<details>
<summary>Where these answers come from, and the trap in reading the file</summary>

descr_beliefs.txt declares all ${BELIEF_ORDER.length}, but not at the same indent: twelve of them, the Anatolian set,
are written one tab deeper than the rest. A pattern anchored on a single tab finds ${SINGLE_TAB_BLOCKS} — and
every one of the twelve it misses is a people the map uses, so the loss would have fallen
exactly where it matters. A block is recognised here by the \`"religion icon"\` line it carries
instead, which gives ${BELIEF_ORDER.length}, and a flat pattern over the file text finds ${RAW_ICON_LINES} of those lines and
${RAW_NAME_LINES} \`"name"\` lines. All three numbers are printed on every run.

Where a belief is comes from the \`rel_<belief>_<tier>\` tags in descr_regions.txt — **the digit
is a 1-4 strength tier, not a percentage**. Who follows it is stated by two files that do not
always agree, and both are shown.

</details>

## What a belief does, and what it does not

- **It is a number, not a key.** No building level and no recruitment line in the mod is
  conditioned on a belief. All ${num(LEVEL_BLOCKS)} building level blocks and all ${num(EDB.recruits.length)} \`recruit\` lines were
  checked against every \`rel_<belief>_<tier>\` token: **${gatedLevels}** levels and **${gatedRecruits}** recruit lines
  came back. Nothing is unlocked by what a province believes.
- **No belief creates unrest against another.** All ${BELIEF_ORDER.length} declare a heretic multiplier of
  ${uniq(FACTS.map((f) => (f.b.mult || {}).heretics)).join("/")} and a heathen multiplier of ${uniq(FACTS.map((f) => (f.b.mult || {}).heathens)).join("/")}. The base game's religious
  friction is switched off across the board.
- **What the tier does decide** is how much \`religious_belief\` a settlement's own buildings
  generate: the same level grants a different amount at each of the four tiers, and each page
  prints that mapping for its own belief.
- **Culture and belief are separate axes.** ${(() => {
  const spread = new Map();
  for (const f of Object.values(FACTIONS)) {
    if (!f.culture || !f.religion) continue;
    if (!spread.has(f.culture)) spread.set(f.culture, new Set());
    spread.get(f.culture).add(f.religion);
  }
  const multi = [...spread.values()].filter((s) => s.size > 1).length;
  return `${multi} of the ${spread.size} cultures have factions on more than one belief. The cultures are on [their own pages](cultures.md).`;
})()}

## The ${BELIEF_ORDER.length} beliefs, by group

Three of these columns count regions, and they are not the same count.

- **Regions** — how many carry the belief's tag at all, at any strength.
- **Majority** — how many carry it at the top of the 1–4 scale, which is the strength a region's
  dominant belief has.
- **Its people live in** — how many name that people in their ancestry, which is a different
  field entirely: who lives there, as shares that sum to 100. A region can be full of a people
  whose belief it does not carry, and carry a belief none of its people are named for. The two
  do not line up region for region, and each belief's page says by how much.

A group has no name of its own in the mod: descr_beliefs.txt declares a token and no text file
localises it. ${groupNamed.viaBelief.size} of the ${groupNamed.viaBelief.size + groupNamed.token.size} group tokens are also belief tokens and take that belief's own
declared name; ${groupNamed.token.size === 1 ? `the one that is not — \`${[...groupNamed.token][0]}\` — is` : `the ${groupNamed.token.size} that are not are`} printed as ${groupNamed.token.size === 1 ? "it stands" : "they stand"}, in lower case, rather than
given a name this wiki made up.

${groupSections}

${onNoFaction.length ? `## Beliefs no faction defaults to\n\n**${onNoFaction.length}** of the ${BELIEF_ORDER.length} are the default religion of no faction in descr_sm_factions.txt: ${onNoFaction.map((f) => `${pipRel(f.tok, "")}[${f.name}](religions/${f.tok}.md)`).join(", ")}. ${onNoFaction.filter((f) => f.regions.size).length} of those ${onNoFaction.filter((f) => f.regions.size).length === 1 ? "is" : "are"} still on the map, held by provinces rather than by a state.\n` : ""}
`;
fs.writeFileSync(path.join(OUT, "religions.md"), indexBody, "utf8");

// ── report ───────────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
say(`belief pages -> ${path.join(OUT, "religions")} (+ religions.md, religions/index.json)`);
say(`  descr_beliefs.txt, counted three ways:`);
say(`    blocks recognised by their "religion icon" line: ${BELIEF_ORDER.length}   <- what these pages use`);
say(`    blocks a single-tab pattern would have found:    ${SINGLE_TAB_BLOCKS}   <- the trap; the ${BELIEF_ORDER.length - SINGLE_TAB_BLOCKS} it misses are the Anatolian set, written one tab deeper`);
say(`    flat count of "religion icon" lines: ${RAW_ICON_LINES} · of "name" lines: ${RAW_NAME_LINES}`);
say(`    ${BELIEF_ORDER.length === RAW_ICON_LINES && RAW_ICON_LINES === RAW_NAME_LINES ? "the block walk and both flat counts AGREE" : "THE COUNTS DISAGREE — a block is being lost or double-counted"}`);
// Every field, counted across all 53 rather than trusted from one. `trait` and `unrest icon`
// are declared ABOVE the `religion icon` line, and an earlier version of the parser registered
// the block on that line and assigned afterwards — so both came back empty for every belief and
// the pages read "not determined" 53 times without anything failing. These counts are what say
// a field is genuinely absent rather than being dropped on the way in.
{
  const has = (k) => FACTS.filter((f) => f.b[k] != null).length;
  const raw = (re) => (BELIEF_TXT.match(re) || []).length;
  const rows = [
    ["religion icon", has("icon"), raw(/"religion icon"\s*:/g)],
    ["name key", has("nameKey"), raw(/"name"\s*:/g)],
    ["trait", has("trait"), raw(/"trait"\s*:/g)],
    ["group", has("group"), raw(/"group"\s*:/g)],
    ["unrest icon", has("unrestIcon"), raw(/"unrest icon"\s*:/g)],
    ["unrest tooltip", has("unrestKey"), raw(/"unrest tooltip"\s*:/g)],
    ["hide at zero", has("hideAtZero"), raw(/"hide at zero"\s*:/g)],
    ["heretic multiplier", FACTS.filter((f) => f.b.mult && f.b.mult.heretics != null).length, raw(/"heretics"\s*:/g)],
    ["heathen multiplier", FACTS.filter((f) => f.b.mult && f.b.mult.heathens != null).length, raw(/"heathens"\s*:/g)],
  ];
  say(`  fields read, parser vs a flat pattern over the file — the pair must match or a field is being dropped:`);
  for (const [k, n, r] of rows) say(`    ${k.padEnd(20)} ${String(n).padStart(3)} / ${String(r).padStart(3)}${n === r ? "" : "   <- MISMATCH"}`);
  const distinct = (get) => uniq(FACTS.map(get)).length;
  say(`    distinct values: heretics ${distinct((f) => (f.b.mult || {}).heretics)}, heathens ${distinct((f) => (f.b.mult || {}).heathens)}, hide-at-zero ${distinct((f) => f.b.hideAtZero)}, info button ${distinct((f) => f.b.infoButton)}`);
}
say(`  display names: ${nameVia.declared.size} via the key the belief declares, ${nameVia.convention.size} via the <TOKEN>_LABEL convention, ${nameVia.none.size} with no entry (token printed)${nameVia.none.size ? ` — ${[...nameVia.none].join(", ")}` : ""}`);
say(`  groups: ${uniq(FACTS.map((f) => f.group).filter(Boolean)).length} declared${FACTS.filter((f) => !f.group).length ? `, ${FACTS.filter((f) => !f.group).length} beliefs with none` : ", every belief in one"} · groups the buildings file tests directly: ${GROUP_ALIASES.length} (${GROUP_ALIASES.join(", ")})`);
say(`    group names: no text file localises a group token, so ${groupNamed.viaBelief.size} borrow the name of the belief of the same token and ${groupNamed.token.size} print the token as it stands${groupNamed.token.size ? ` (${[...groupNamed.token].join(", ")})` : ""}`);
say(`\n  descr_regions.txt, counted twice:`);
say(`    belief tags found by the block walk: ${num(relTagsSeen)} · by a flat pattern over the file: ${num(RAW_REL_TAGS)}`);
say(`    ${relTagsSeen === RAW_REL_TAGS ? "the two counts AGREE" : "THE TWO COUNTS DISAGREE — a region block is being lost"}`);
say(`    region blocks read: ${num(REGIONS.length)} · distinct beliefs tagged: ${tierOf.size} · tags not of the rel_<belief>_<tier> shape: ${oddRelTags.length}${oddRelTags.length ? ` (${oddRelTags.slice(0, 5).join("; ")})` : ""}`);
say(`    beliefs declared but on no region: ${onNoRegion.length}${onNoRegion.length ? ` (${onNoRegion.map((f) => f.tok).join(", ")})` : ""}`);
{
  const undeclared = [...tierOf.keys()].filter((t) => !BELIEFS[t]);
  say(`    beliefs tagged on a region but not declared: ${undeclared.length}${undeclared.length ? ` (${undeclared.join(", ")})  <- these would have no page` : ""}`);
  const peoplesUndeclared = [...peopleIn.keys()].filter((t) => !BELIEFS[t]);
  say(`    peoples named in the ancestry field but not declared as a belief: ${peoplesUndeclared.length}${peoplesUndeclared.length ? ` (${peoplesUndeclared.join(", ")})` : ""}`);
  say(`    peoples named in the ancestry field: ${peopleIn.size} · distinct tokens across both fields: ${uniq([...peopleIn.keys(), ...tierOf.keys()]).length}`);
}
say(`\n  who follows what, from two files:`);
say(`    descr_sm_factions.txt: ${num(Object.keys(FACTIONS).length)} faction blocks, ${num(RAW_RELIGION_LINES)} "default religion" lines by a flat pattern  <- must match`);
say(`    ${Object.keys(FACTIONS).length === RAW_RELIGION_LINES ? "the two counts AGREE" : "THE TWO COUNTS DISAGREE"}`);
say(`    factions with no default religion: ${factionsWithNoReligion.length}${factionsWithNoReligion.length ? ` (${factionsWithNoReligion.join(", ")})` : ""}`);
say(`    distinct beliefs used as a default religion: ${uniq(Object.values(FACTIONS).map((f) => f.religion).filter(Boolean)).length} of ${BELIEF_ORDER.length}`);
say(`    export_descr_buildings.txt faction_religion_<belief> aliases: ${Object.keys(ALIAS_FOLLOWERS).length}`);
{
  const rows = [];
  for (const f of FACTS) {
    if (!f.alias) continue;
    const aliasOnly = f.alias.filter((x) => !f.facs.includes(x) && !CULTURE_TOKENS.has(x));
    const defaultOnly = f.facs.filter((x) => !f.alias.includes(x));
    if (aliasOnly.length || defaultOnly.length) rows.push(`      ${f.tok.padEnd(20)} alias names ${aliasOnly.length ? aliasOnly.join(", ") : "-"} · descr_sm_factions alone says ${defaultOnly.length ? defaultOnly.join(", ") : "-"}`);
  }
  say(`    DISAGREEMENTS between the two, published on the pages and NOT resolved: ${rows.length}`);
  for (const r of rows) say(r);
  const noAlias = FACTS.filter((f) => !f.alias);
  say(`    beliefs with no faction_religion alias at all: ${noAlias.length}${noAlias.length ? ` (${noAlias.map((f) => f.tok).join(", ")})` : ""}`);
}
say(`\n  export_descr_buildings.txt, what a belief does:`);
say(`    conditional effect lines in the file: ${num(EDB.effects.length)} · religious_belief grants: ${num([...GENERATORS.values()].reduce((a, v) => a + v.length, 0))} naming ${GENERATORS.size} beliefs`);
say(`    building levels gated on a belief: ${gatedLevels} of ${num(LEVEL_BLOCKS)} level blocks  <- a zero here is the finding, not a failure`);
say(`    recruit lines gated on a belief:   ${gatedRecruits} of ${num(EDB.recruits.length)}`);
{
  const noGen = FACTS.filter((f) => !f.generators.length);
  say(`    beliefs nothing in the mod generates: ${noGen.length}${noGen.length ? ` (${noGen.map((f) => f.tok).join(", ")})` : ""}`);
  const perTier = FACTS.filter((f) => [...f.gated.values()].some((u) => u && u.effects.length)).length;
  say(`    beliefs with a tier-scaled grant: ${perTier} of ${BELIEF_ORDER.length}`);
}
say(`\n  pips reused from belief-icons/ (written by gen-ris-region-pages.js, never re-converted here):`);
say(`    files present: ${beliefIcons.size} · beliefs with one: ${FACTS.filter((f) => beliefIcons.has(f.tok)).length} of ${BELIEF_ORDER.length}${FACTS.filter((f) => !beliefIcons.has(f.tok)).length ? ` · WITHOUT: ${FACTS.filter((f) => !beliefIcons.has(f.tok)).map((f) => f.tok).join(", ")}` : ""}`);
say(`    icon files with no belief of that name: ${[...beliefIcons].filter((t) => !BELIEFS[t]).length}`);
say(`\n  links into other page families (absent families cost pictures and links, never facts):`);
say(`    faction pages ${factionPages.size} · region pages ${regionPages.size} · building chain pages ${buildingPages.size} · symbols ${symbolFiles.size}`);
say(`    cultures linked: ${cultureLinked} (${Object.keys(CULTURE_INDEX).length} in cultures/index.json)${Object.keys(CULTURE_INDEX).length ? "" : "  <- run gen-ris-culture-pages.js, then this generator again"}`);
say(`    display names: ${levelNameMisses} building levels with no text entry`);
say(`\n  pages written: ${FACTS.length} under religions/, plus religions.md and religions/index.json`);
say(`  NEXT: run gen-ris-faction-pages.js and gen-ris-region-pages.js so their belief values link here`);
