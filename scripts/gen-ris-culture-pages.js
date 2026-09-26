#!/usr/bin/env node
/**
 * One reference page per CULTURE, plus the index that lists them all.
 *
 *   node scripts/gen-ris-culture-pages.js [--ris <dir>] [--out <dir>]
 *
 * Run it BEFORE gen-ris-faction-pages.js and gen-ris-region-pages.js — both read
 * cultures/index.json to link the culture they print, exactly as they already read
 * tags/index.json and sizes/index.json. Run it AFTER gen-ris-faction-pages.js if you want the
 * faction emblems on these pages; their absence costs pictures, never facts.
 *
 * A faction page says its culture and a region page names one, and that was a dead end — the
 * same dead end the region tags and the settlement sizes had before tags/ and sizes/ existed.
 * These pages answer what a culture actually DECIDES.
 *
 * THE NAME IS NOT THE TOKEN, and three of the twenty-two would have been mislabelled by
 * printing it: `barbarian` is **Gallic**, `eastern` is **Caucasian**, `carthaginian` is
 * **Phoenician**. The cascade is the one gen-ris-faction-pages.js already uses and is repeated
 * here for the same reason it is written down there: a bare `{<culture>}` entry exists for all
 * 22, a `{<culture>_label}` for 13, and menu_english's `{UI_<CULTURE>}` for 14. Where two
 * exist they agree, except on those three renames, which the run output names one by one so a
 * future rename cannot slip past.
 *
 * WHAT A CULTURE DECIDES, and how that is established rather than described:
 *
 *   1. WHO IS IN IT — descr_sm_factions.txt gives every one of the 239 faction blocks a
 *      `"culture"`. That is the only file that assigns one, and it is read by a block walk and
 *      again by a flat pattern, both counted.
 *
 *   2. WHAT IT LETS YOU BUILD AND RAISE — export_descr_buildings.txt. This is the part that
 *      looked at first as though it did not exist: there is no `culture` keyword in a
 *      `requires` expression anywhere in the file. What there IS is the engine's own overload
 *      of the faction list. Of the 257 distinct tokens that appear inside a `factions { … }`
 *      or `building_factions { … }` clause, 234 are faction tokens, one is `all`, and the
 *      remaining 22 are exactly the 22 culture tokens — none of which is a faction. So a
 *      culture is gated on the same way a faction is, and every clause naming one is a clause
 *      about the whole culture. Negated clauses count: being Gallic blocking a level is as
 *      real a consequence as being Gallic unlocking one.
 *
 *   3. WHAT ITS SETTLEMENTS LOOK LIKE — two files, which disagree, and the disagreement is
 *      published rather than resolved. descr_cultures.txt declares a `settlement icons` card
 *      per size for all 22 cultures and a `max settlement level` of `huge_city` for all 22.
 *      descr_sm_settlements.txt, which is where a culture gets its strategy-map MODEL,
 *      declares a block for only 8 of the 22, and two of those eight — barbarian and
 *      scythian — stop at `city` with no `large_city` or `huge_city` block at all. Which of
 *      the two the engine obeys is not determined from the mod files. Both are stated.
 *
 *   4. THE POPULATION LADDER — descr_cultures.txt again, and every one of the 22 declares the
 *      same six rungs with the same five numbers, so the ladder is not a way one culture
 *      differs from another. Said in those words on the page, with the numbers left on the
 *      settlement-size pages that own them, rather than repeated 22 times.
 *
 * WHERE THE FILES SAY NOTHING, THE PAGE SAYS SO, with the number of things that were examined.
 * A silently empty section looks like a parsing failure and this generator has no way to tell
 * the reader apart from itself.
 */
const fs = require("fs");
const BUILDINGS = require("./ris-wiki-buildings.js");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/_wiki");
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
// Matches both GitHub's heading-anchor rule and the local viewer's slugId(). The pair has to
// agree or every in-page link breaks in exactly one of the two places.
const anchor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = (n) => Number(n).toLocaleString("en-US");
const uniq = (a) => [...new Set(a)];
// The opening tag and the <summary> go on SEPARATE lines. Written as one line the local viewer
// does not see a block and prints the contents as literal text on the page.
const fold = (summary, lines) => `<details>\n<summary>${summary}</summary>\n\n${lines.join("\n")}\n\n</details>`;
// A requirement may contain a pipe, and an unescaped one splits a markdown table row into
// extra columns.
const cell = (s) => String(s).replace(/\|/g, "\\|");

const L = require(path.join(__dirname, "lib", "edbRecruit.js"));
const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));

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
const BUILDING_NAMES = loadText("export_buildings.txt");
const UNIT_TEXT = loadText("export_units.txt");
const BI_NAMES = loadText("expanded_bi.txt");
const SHARED = loadText("shared.txt");
const FACTION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "campaign_descriptions.txt"), "utf16le");
    for (const m of t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_TITLE\}([^\r\n]*)/g)) out[m[1].toLowerCase()] = m[2].trim();
  } catch { /* tokens */ }
  return out;
})();

// Every text/*.txt indexed once, for the culture-name cascade. The keys are spread across
// several files — the bare `{<culture>}` entries live in expanded_bi.txt and the
// `{UI_<CULTURE>}` ones in menu_english.txt — so no single file answers it.
const ALL_TEXT = (() => {
  const map = {};
  let files = [];
  try { files = fs.readdirSync(path.join(RIS, "text")).filter((n) => /\.txt$/i.test(n) && !/_mac_/.test(n)); } catch { /* none */ }
  for (const f of files) {
    let t = "";
    try { t = fs.readFileSync(path.join(RIS, "text", f), "utf16le"); } catch { continue; }
    for (const m of t.matchAll(/\{([A-Za-z0-9_]+)\}(.*)/g)) {
      const k = m[1].trim().toLowerCase();
      if (!(k in map)) map[k] = m[2].trim();
    }
  }
  return map;
})();

// The same cascade gen-ris-faction-pages.js uses, and deliberately the same order, so a culture
// reads identically on a faction page, a region page and here. Every hop is counted.
const cultureNamed = { bare: 0, label: 0, ui: 0, none: [] };
const cultureRenames = [];
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
function cultureName(tok) {
  if (!tok) return null;
  const t = String(tok).toLowerCase();
  const bare = ALL_TEXT[t], label = ALL_TEXT[`${t}_label`], ui = ALL_TEXT[`ui_${t}`];
  if (bare && ui && bare.toLowerCase() !== ui.toLowerCase() && !cultureRenames.some((r) => r[0] === t)) {
    cultureRenames.push([t, bare, ui]);
  }
  if (bare) { cultureNamed.bare++; return bare; }
  if (label) { cultureNamed.label++; return label; }
  if (ui) { cultureNamed.ui++; return titleCase(ui); }
  if (!cultureNamed.none.includes(t)) cultureNamed.none.push(t);
  return null;
}
// The claim on the index page — "the display name is not the token" — checked rather than
// asserted: a culture is counted as renamed when the mod's own name for it is not what
// knocking the underscores out of the token would produce.
const humaniseTok = (t) => String(t).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const isRenamed = (t) => {
  const n = cultureName(t);
  return !!n && n.toLowerCase() !== humaniseTok(t).toLowerCase();
};

// Same exclusion set as gen-ris-faction-pages.js and gen-ris-region-pages.js: linking a faction
// with no page was 1,006 broken links once already.
const NO_PAGE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
const npName = (f) => BI_NAMES[String(f).toLowerCase()] || String(f).replace(/_/g, " ");
// The two Roman and two Seleucid rebel factions share a name ("Roman Rebels"; the faction-select
// text even calls both Roman ones "Rome"). The revolt generator publishes what tells them apart,
// and every page uses those words.
const SHARED_LABELS = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, "revolts", "index.json"), "utf8")).labels || {}; } catch { return {}; } })();
const facName = (f) => SHARED_LABELS[String(f).toLowerCase()] || FACTION_NAMES[String(f).toLowerCase()] || npName(f);

const dirNames = (sub, ext) => {
  try { return new Set(fs.readdirSync(path.join(OUT, sub)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length))); }
  catch { return new Set(); }
};
const buildingPages = dirNames("buildings", ".md");
const unitPages = dirNames("units", ".md");
const factionPages = dirNames("factions", ".md");
const symbolFiles = dirNames("symbols", ".png");
const cardFiles = dirNames("cards", ".png");

const facLink = (f) => (NO_PAGE.has(String(f).toLowerCase())
  ? `[${facName(f)}](../factions/non-playable.md)`
  : factionPages.has(String(f)) ? `[${facName(f)}](../factions/${f}.md)` : `**${facName(f)}**`);

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
const unitKey = (type) => TYPE_TO_DICT[String(type).toLowerCase()] || `type:${String(type).toLowerCase()}`;
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
// The team's name for the chain. Without this the column printed the raw token with its
// underscores swapped for spaces — "salted fish", "academic" — which is the file's name for
// the thing, not the game's or the team's.
const chainLabel = (chain) => BUILDINGS.chainName(chain, String(chain).replace(/_/g, " "));
const levelLink = (chain, level) => {
  const p = String(chain).toLowerCase();
  const label = `**${levelName(level)}**`;
  return buildingPages.has(p) ? `[${label}](../buildings/${p}.md)` : label;
};
const chainLink = (chain) => {
  const p = String(chain).toLowerCase();
  return buildingPages.has(p) ? `[${chainLabel(chain)}](../buildings/${p}.md)` : chainLabel(chain);
};

let ICONS = {};
try { ICONS = JSON.parse(fs.readFileSync(path.join(OUT, "icons", "index.json"), "utf8")); } catch { /* no icons yet */ }
/** A building level's icon AS THIS CULTURE draws it, which is the whole point of asking here. */
const iconFor = (culture, level) => ICONS[`${String(culture).toLowerCase()}/${String(level).toLowerCase()}`] || null;

// ── the vocabulary of cultures, derived three ways ───────────────────────────
// descr_cultures.txt DECLARES them, descr_sm_factions.txt ASSIGNS them, and
// export_descr_buildings.txt CONDITIONS on them. Three files written for three purposes; if
// they ever stopped agreeing that is a finding, not a rounding error, so all three counts are
// taken and printed.
function loadCultureBlocks(txt) {
  const out = [];
  let cur = null, section = null, lvl = null, agent = null;
  for (const raw of String(txt || "").split(L.SPLIT_EOL)) {
    const line = raw.replace(/;;.*$/, "");
    const t = line.trim();
    if (!t) continue;
    let m = /^"([a-z0-9_ ]+)"\s*:\s*$/.exec(t);
    if (m) {
      const tok = m[1];
      if (tok === "cultures") continue;
      // A culture block is the one at ONE tab of indent. Keys with spaces are real
      // (`settlement upgrade levels`, `min pop`), which is why the class allows a space — a
      // `[a-z0-9_]+` class silently matches nothing and every culture comes back empty.
      if (/^\t"/.test(line)) { cur = { tok, levels: {}, icons: {}, unrest: {}, agents: {}, fort: {}, watchtower: {} }; out.push(cur); section = null; lvl = null; agent = null; continue; }
      if (!cur) continue;
      if (tok === "settlement upgrade levels") { section = "levels"; lvl = null; continue; }
      if (tok === "settlement icons") { section = "icons"; continue; }
      if (tok === "unrest factors") { section = "unrest"; continue; }
      if (tok === "fort") { section = "fort"; continue; }
      if (tok === "watchtower") { section = "watchtower"; continue; }
      if (tok === "agents") { section = "agents"; agent = null; continue; }
      if (section === "levels") { lvl = tok; cur.levels[lvl] = {}; continue; }
      if (section === "agents") { agent = tok; cur.agents[agent] = {}; continue; }
      continue;
    }
    if (!cur) continue;
    m = /^"max settlement level"\s*:\s*"([a-z_]+)"/.exec(t);
    if (m) { cur.max = m[1]; continue; }
    m = /^"string"\s*:\s*"([A-Za-z0-9_]+)"/.exec(t);
    if (m) { cur.string = m[1]; continue; }
    m = /^"portrait mapping"\s*:\s*"([a-z_]+)"/.exec(t);
    if (m) { cur.portrait = m[1]; continue; }
    m = /^"civilised"\s*:\s*(true|false)/.exec(t);
    if (m) { cur.civilised = m[1] === "true"; continue; }
    m = /^"ai assist under settlements"\s*:\s*([\d.]+)/.exec(t);
    if (m) { cur.aiAssist = parseFloat(m[1]); continue; }
    if (section === "icons") {
      m = /^"([a-z_]+)"\s*:\s*"([^"]+)"/.exec(t);
      if (m) { cur.icons[m[1]] = m[2]; continue; }
    }
    if (section === "unrest") {
      m = /^"([a-z ]+)"\s*:\s*(-?[\d.]+)/.exec(t);
      if (m) { cur.unrest[m[1]] = parseFloat(m[2]); continue; }
    }
    if (section === "fort" || section === "watchtower") {
      m = /^"([a-z ]+)"\s*:\s*"?([^",]+)"?,/.exec(t);
      if (m) { cur[section][m[1]] = m[2].trim(); continue; }
    }
    if (section === "agents" && agent) {
      m = /^"([a-z ]+)"\s*:\s*"?([^",]+)"?,/.exec(t);
      if (m) { cur.agents[agent][m[1]] = m[2].trim(); continue; }
    }
    if (section === "levels" && lvl) {
      m = /^"([a-z ]+)"\s*:\s*(-?\d+)/.exec(t);
      if (m) { cur.levels[lvl][m[1]] = parseInt(m[2], 10); continue; }
    }
  }
  return out;
}
const CULTURES = loadCultureBlocks(rd("descr_cultures.txt"));
if (!CULTURES.length) { console.error("no cultures parsed from descr_cultures.txt"); process.exit(2); }
const CULTURE_TOKENS = CULTURES.map((c) => c.tok);
const IS_CULTURE = new Set(CULTURE_TOKENS);

// faction -> culture and faction -> default religion, by a block walk over descr_sm_factions.
const FACTIONS = (() => {
  const out = {};
  let cur = null;
  for (const raw of (rd("descr_sm_factions.txt") || "").split(L.SPLIT_EOL)) {
    const line = raw.replace(/;.*$/, "");
    let m = /^\t"([a-z0-9_]+)"\s*:/.exec(line);
    if (m) { cur = m[1].toLowerCase(); out[cur] = out[cur] || { faction: cur }; continue; }
    if (!cur) continue;
    m = /"culture"\s*:\s*"([a-z_]+)"/.exec(line);
    if (m) { out[cur].culture = m[1].toLowerCase(); continue; }
    m = /"default religion"\s*:\s*"([a-z_]+)"/.exec(line);
    if (m) { out[cur].religion = m[1].toLowerCase(); continue; }
  }
  return out;
})();
// The second derivation: a flat pattern over the same file with no block structure involved.
// If the block walk ever loses a faction this is what says so.
const RAW_CULTURE_LINES = ((rd("descr_sm_factions.txt") || "").match(/"culture"\s*:\s*"[a-z_]+"/g) || []).length;
const RAW_CULTURE_COUNTS = (() => {
  const out = {};
  for (const m of (rd("descr_sm_factions.txt") || "").matchAll(/"culture"\s*:\s*"([a-z_]+)"/g)) {
    out[m[1]] = (out[m[1]] || 0) + 1;
  }
  return out;
})();
const factionsOf = (tok) => Object.values(FACTIONS).filter((f) => f.culture === tok).map((f) => f.faction).sort();
const culturesAssigned = uniq(Object.values(FACTIONS).map((f) => f.culture).filter(Boolean)).sort();
const factionsWithNoCulture = Object.values(FACTIONS).filter((f) => !f.culture).map((f) => f.faction);

// ── what the buildings file conditions on a culture ──────────────────────────
// The engine's faction list accepts a culture token as well as a faction token, and that is
// the ONLY mechanism by which anything in export_descr_buildings.txt is keyed on culture: the
// word `culture` never appears in a `requires` expression in the file. Established by
// classifying every token that appears inside one of these clauses — the leftovers after the
// faction tokens and `all` are exactly the 22 cultures, and no culture is also a faction.
const FACTION_LIST_ATOM = /^(building_)?factions\s*\{([^}]*)\}$/i;
const ALL_LIST_TOKENS = new Set();
let listClauses = 0;
function listTokens(atom) {
  const m = FACTION_LIST_ATOM.exec(atom.trim());
  if (!m) return null;
  listClauses++;
  const toks = m[2].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const t of toks) ALL_LIST_TOKENS.add(t);
  return { building: !!m[1], toks };
}

// Aliases can hide a faction list one indirection away — `faction_religion_italic` is nothing
// but `requires factions { roman, … }` — so an alias's own culture mentions are folded in with
// the right sign, exactly as lib/edbRecruit.js does for hidden resources.
const flip = (s) => (s === "requires" ? "excludes" : s === "excludes" ? "requires" : "both");
function merge(map, tok, sign) {
  const cur = map.get(tok);
  map.set(tok, !cur || cur === sign ? sign : "both");
}
const aliasSign = new Map();
function signsOf(name, stack) {
  const low = String(name).toLowerCase();
  if (aliasSign.has(low)) return aliasSign.get(low);
  const out = new Map();
  aliasSign.set(low, out);
  if (stack.includes(low)) return out;
  const body = ALIASES[low];
  if (body == null) return out;
  for (const { atom, negated } of L.splitTerms(body).terms) {
    const lt = listTokens(atom);
    if (lt) { for (const t of lt.toks) if (IS_CULTURE.has(t)) merge(out, t, negated ? "excludes" : "requires"); continue; }
    const sub = String(atom).trim().toLowerCase();
    if (ALIASES[sub] != null) {
      for (const [tok, sign] of signsOf(sub, [...stack, low])) merge(out, tok, negated ? flip(sign) : sign);
    }
  }
  return out;
}
const aliasesNaming = new Map();     // culture -> [{alias, sign}]
for (const name of Object.keys(ALIASES)) {
  for (const [tok, sign] of signsOf(name, [])) {
    if (!aliasesNaming.has(tok)) aliasesNaming.set(tok, []);
    aliasesNaming.get(tok).push({ alias: name, sign });
  }
}
function scan(requires) {
  const found = new Map();
  for (const { atom, negated } of L.splitTerms(requires || "").terms) {
    const lt = listTokens(atom);
    if (lt) { for (const t of lt.toks) if (IS_CULTURE.has(t)) merge(found, t, negated ? "excludes" : "requires"); continue; }
    const low = String(atom).trim().toLowerCase();
    if (ALIASES[low] != null) {
      for (const [tok, sign] of signsOf(low, [])) merge(found, tok, negated ? flip(sign) : sign);
    }
  }
  return found;
}

const USAGE = new Map();   // culture -> { levels, blockedLevels, recruits, blockedRecruits, effects, blockedEffects }
const usageOf = (tok) => {
  if (!USAGE.has(tok)) USAGE.set(tok, { levels: [], blockedLevels: [], recruits: [], blockedRecruits: [], effects: [], blockedEffects: [] });
  return USAGE.get(tok);
};
for (const t of CULTURE_TOKENS) usageOf(t);
for (const c of EDB.chains) {
  for (const l of Object.values(c.levels)) {
    if (!l.requires) continue;
    for (const [tok, sign] of scan(l.requires)) {
      const e = usageOf(tok);
      (sign === "excludes" ? e.blockedLevels : e.levels).push({ chain: c.chain, level: l.level, sign });
    }
  }
}
for (const r of EDB.recruits) {
  for (const [tok, sign] of scan(r.requires)) {
    const e = usageOf(tok);
    (sign === "excludes" ? e.blockedRecruits : e.recruits).push({ ...r, sign });
  }
}
for (const f of EDB.effects) {
  for (const [tok, sign] of scan(f.requires)) {
    const e = usageOf(tok);
    (sign === "excludes" ? e.blockedEffects : e.effects).push({ ...f, sign });
  }
}
// ── "only this culture", proved rather than read off the list ────────────────
// USAGE says a level or unit NAMES a culture in a faction list. That is not "only": the Great
// Forum's list names 13 cultures, and the Cothon's warships name Carthaginian factions beside the
// Romans. So each requirement is evaluated for every faction in the game (the three-valued
// evaluator in lib/edbRecruit.js, as a player): exclusive means it is provably false for every
// faction outside the culture, and not false for at least one inside it. Anything the evaluator
// cannot decide (a region tag, a building elsewhere) counts as open, so a list can only be too
// short, never wrong. The evaluator tests a faction list by faction key, so the culture tokens
// in those lists are expanded to their factions first; `building_factions` (who BUILT it) is
// left alone and stays undecided. The `dummies` test faction is not a faction any campaign has.
const MEMBERS = new Map(CULTURE_TOKENS.map((t) => [t, Object.values(FACTIONS).filter((f) => f.culture === t).map((f) => f.faction)]));
const expandLists = (expr) => String(expr || "").replace(/(^|[^A-Za-z_])factions\s*\{([^}]*)\}/gi, (all, pre, body) => {
  const toks = body.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return `${pre}factions { ${uniq(toks.flatMap((t) => MEMBERS.get(t) || [t])).join(", ")}, }`;
});
const EXP_ALIASES = Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [k, expandLists(v)]));
const EVAL_FACTIONS = Object.keys(FACTIONS).filter((f) => f !== "dummies");
const openTo = (expr, faction) => L.evaluate(expandLists(expr), { faction, isPlayer: true }, EXP_ALIASES).value !== false;
/** True when `exprs` (one requirement, or every route to one thing) are open only to culture tok. */
function onlyFor(tok, exprs) {
  const inside = new Set(MEMBERS.get(tok) || []);
  const list = [].concat(exprs);
  if (!list.some((e) => [...inside].some((f) => openTo(e, f)))) return false;
  return EVAL_FACTIONS.every((f) => inside.has(f) || list.every((e) => !openTo(e, f)));
}
/** True when every one of `exprs` is closed to every faction of culture tok. */
const closedTo = (tok, exprs) => (MEMBERS.get(tok) || []).every((f) => [].concat(exprs).every((e) => !openTo(e, f)));
const RECRUITS_BY_UNIT = new Map();   // unitKey -> every requires that recruits it, anywhere
for (const r of EDB.recruits) {
  const k = unitKey(r.unit);
  if (!RECRUITS_BY_UNIT.has(k)) RECRUITS_BY_UNIT.set(k, []);
  RECRUITS_BY_UNIT.get(k).push(r.requires || "");
}
const LEVEL_REQ = new Map();
for (const c of EDB.chains) for (const l of Object.values(c.levels)) LEVEL_REQ.set(`${c.chain}|${l.level}`, l.requires || "");
const exclusivity = { levels: 0, levelsDropped: 0, units: 0, unitsDropped: 0, effects: 0, effectsDropped: 0 };

// The claim this whole section rests on, measured: every token that appears in a faction list
// is either a faction, `all`, or one of the 22 cultures, and no culture is also a faction.
const FACTION_TOKENS = new Set(Object.keys(FACTIONS));
const LIST_UNCLASSIFIED = [...ALL_LIST_TOKENS].filter((t) => t !== "all" && !FACTION_TOKENS.has(t) && !IS_CULTURE.has(t));
const CULTURES_ALSO_FACTIONS = CULTURE_TOKENS.filter((t) => FACTION_TOKENS.has(t));
const CULTURES_IN_LISTS = CULTURE_TOKENS.filter((t) => ALL_LIST_TOKENS.has(t));

// The word the engine would use if the mod gated on culture directly. Searched for, so the
// sentence on the page is a measured absence rather than an assumption.
const CULTURE_KEYWORD_CLAUSES = (() => {
  let n = 0;
  const test = (s) => { if (/\bculture\b/i.test(s || "")) n++; };
  for (const c of EDB.chains) for (const l of Object.values(c.levels)) test(l.requires);
  for (const r of EDB.recruits) test(r.requires);
  for (const f of EDB.effects) test(f.requires);
  return n;
})();

// ── effect wording ───────────────────────────────────────────────────────────
const sgn = (n) => (n >= 0 ? `+${n}` : String(n));
const beliefLabel = (tok) => BI_NAMES[`${String(tok).toLowerCase()}_label`]
  || BI_NAMES[`${String(tok).toLowerCase().replace(/_/g, "-")}_label`] || String(tok).replace(/_/g, " ");
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
  recruitment_slots: (n) => `recruitment slots ${sgn(n)}`,
  recruits_morale_bonus: (n) => `recruit morale ${sgn(n)}`,
  recruits_exp_bonus: (n) => `recruit experience ${sgn(n)}`,
  weapon_melee_simple: (n) => `melee weapon upgrade ${sgn(n)}`,
  weapon_missile_simple: (n) => `missile weapon upgrade ${sgn(n)}`,
  armour: (n) => `armour upgrade ${sgn(n)}`,
  stage_games: (n) => `games ${sgn(n)}`,
  stage_races: (n) => `races ${sgn(n)}`,
  construction_time_bonus_military: (n) => `military construction time ${sgn(n)}%`,
  construction_time_bonus_religious: (n) => `religious construction time ${sgn(n)}%`,
  construction_time_bonus_defensive: (n) => `defensive construction time ${sgn(n)}%`,
  construction_time_bonus_other: (n) => `other construction time ${sgn(n)}%`,
  construction_cost_bonus_defensive: (n) => `defensive construction cost ${sgn(n)}%`,
  construction_cost_bonus_religious: (n) => `religious construction cost ${sgn(n)}%`,
  // `agent <type> N` enables the agent; `agent_limit_settlement <type> N` caps how many the
  // settlement may hold. Both carry the agent as the subject, so both are worded with it.
  agent: (n, subject) => `can recruit ${subject ? subject.replace(/_/g, " ") : "an agent"}${n ? ` (${sgn(n)})` : ""}`,
  agent_limit_settlement: (n, subject) => `${subject ? subject.replace(/_/g, " ") : "agent"} limit ${n}`,
  religious_belief: (n, subject) => `${subject ? beliefLabel(subject) : "religious"} belief ${sgn(n)}`,
};
const unknownEffects = new Map();
function effectWords(e, amount) {
  const n = amount == null ? e.amount : amount;
  const f = EFFECT_WORDS[e.effect];
  if (!f) { unknownEffects.set(e.effect, (unknownEffects.get(e.effect) || 0) + 1); return `\`${e.effect}\` ${sgn(n)}`; }
  return f(n, e.subject);
}
function groupEffects(arr) {
  const m = new Map();
  for (const e of arr) {
    const k = `${e.effect}|${e.subject || ""}|${e.chain}|${e.level}`;
    const g = m.get(k);
    if (!g) m.set(k, { ...e, min: e.amount, max: e.amount });
    else { g.min = Math.min(g.min, e.amount); g.max = Math.max(g.max, e.amount); }
  }
  return [...m.values()];
}
const effectRange = (e) => (e.min === e.max ? effectWords(e, e.min) : `${effectWords(e, e.min)} to ${sgn(e.max)}`);

// ── the campaign start ───────────────────────────────────────────────────────
const STRAT_PATH = path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
const strat = gv.parseStrat(STRAT_PATH) || {};
const heldByFaction = new Map();
let heldTotal = 0;
for (const [fac, v] of Object.entries(strat)) {
  const n = (v.settlements || []).length;
  heldByFaction.set(fac, n);
  heldTotal += n;
}
// The second derivation: a flat pattern over the same file with no block structure involved.
const RAW_SETTLEMENT_LINES = (() => {
  try { return (fs.readFileSync(STRAT_PATH, "latin1").match(/^[ \t]*level[ \t]+[a-z_]+[ \t]*$/gim) || []).length; }
  catch { return 0; }
})();
const REGION_COUNT = (() => {
  const lines = (rd("world", "maps", "base", "descr_regions.txt") || "").split(L.SPLIT_EOL);
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(lines[i])) continue;
    const body = [];
    for (let k = i + 1; k < Math.min(i + 14, lines.length); k++) {
      const t = lines[k].trim();
      if (!t || t.startsWith(";")) continue;
      if (/^[A-Za-z][A-Za-z0-9_'\- ]*$/.test(lines[k])) break;
      body.push(t);
    }
    if (body.findIndex((l) => /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(l)) >= 2) n++;
  }
  return n;
})();

// ── settlement art and architecture ──────────────────────────────────────────
// descr_sm_settlements.txt is where a culture gets its strategy-map MODEL and its UI card for
// each rung. Only 8 of the 22 cultures have a block in it at all; two of those eight stop
// short of the top of the ladder. Both facts are on every page they apply to.
const SM_SETTLEMENTS = (() => {
  const out = new Map();   // culture -> Map(size -> {normal, walls:[], card})
  let cul = null, lvl = null, depth = 0;
  for (const raw of (rd("descr_sm_settlements.txt") || "").split(L.SPLIT_EOL)) {
    const t = raw.replace(/;.*$/, "").trim();
    if (t === "{") { depth++; continue; }
    if (t === "}") { depth--; if (depth === 0) { cul = null; lvl = null; } continue; }
    if (/^[a-z_]+$/.test(t) && depth === 0) { cul = t; out.set(cul, new Map()); continue; }
    if (/^[a-z_]+$/.test(t) && depth === 1 && cul) { lvl = t; out.get(cul).set(lvl, { walls: [] }); continue; }
    if (!cul || !lvl) continue;
    let m = /^normal\s+(\S+)/.exec(t);
    if (m) { out.get(cul).get(lvl).normal = m[1]; continue; }
    m = /^wall\s+(\S+)/.exec(t);
    if (m) { out.get(cul).get(lvl).walls.push(m[1]); continue; }
    m = /^card\s+(\S+)/.exec(t);
    if (m) { out.get(cul).get(lvl).card = m[1]; continue; }
  }
  return out;
})();
const artPath = (p) => {
  const rel = String(p).replace(/\\/g, "/");
  return /^data\//i.test(rel) ? path.join(RIS, rel.slice(5)) : path.join(RIS, "..", rel);
};
/** The `data/ui/<family>/…` folder a declared card lives in — the art FAMILY a culture draws from. */
const artFamily = (p) => {
  const m = /^data\/ui\/([a-z_]+)\//i.exec(String(p).replace(/\\/g, "/"));
  return m ? m[1].toLowerCase() : null;
};

// The ladder and its display names, read from the file that writes those headings rather than
// rebuilt here. Absent, the size is printed as its token and nothing else is lost.
let SIZE_INDEX = {};
try { SIZE_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "sizes", "index.json"), "utf8")); } catch { /* run gen-ris-settlement-sizes.js first */ }
const LADDER = Object.keys(SIZE_INDEX).length
  ? Object.keys(SIZE_INDEX)
  : (() => { const seen = []; for (const c of CULTURES) for (const k of Object.keys(c.levels)) if (!seen.includes(k)) seen.push(k); return seen; })();
let sizeLinked = 0;
const sizeRef = (tok) => {
  const e = SIZE_INDEX[String(tok).toLowerCase()];
  if (!e) return SHARED[`st_${String(tok).toLowerCase()}`] || String(tok).replace(/_/g, " ");
  sizeLinked++;
  return `[${e.name}](../sizes/${e.page})`;
};
const sizeNameOf = (tok) => (SIZE_INDEX[String(tok).toLowerCase()] || {}).name
  || SHARED[`st_${String(tok).toLowerCase()}`] || String(tok).replace(/_/g, " ");

// Where the belief pages are, so a culture can link the beliefs its factions default to.
let RELIGION_INDEX = {};
try { RELIGION_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "religions", "index.json"), "utf8")); } catch { /* run gen-ris-belief-pages.js first */ }
let beliefLinked = 0;
const beliefRef = (tok) => {
  const e = RELIGION_INDEX[String(tok).toLowerCase()];
  if (!e) return `**${beliefLabel(tok)}**`;
  beliefLinked++;
  const pip = e.icon ? `<img src="../${e.icon}" alt="" width="16" height="16" style="vertical-align:text-bottom"> ` : "";
  return `${pip}[**${e.name}**](../religions/${e.page})`;
};

// ── page assembly ────────────────────────────────────────────────────────────
const HEAD = (title) => `# ${title}\n\n[← all cultures](../cultures.md) · [all factions](../factions.md) · [wiki index](../README.md)\n`;


const FOLD_AT = 12;
const maybeFold = (summary, n, table) => (n > FOLD_AT ? fold(summary, [table]) : table);

function cultureFacts(c) {
  const tok = c.tok;
  const u = USAGE.get(tok);
  const facs = factionsOf(tok);
  const held = facs.reduce((a, f) => a + (heldByFaction.get(f) || 0), 0);
  // Only what the evaluator proves (see onlyFor): a level or unit that merely NAMES this culture
  // beside others is left out, because these sections are headed "only <culture>".
  const count = (kind, all, kept) => { exclusivity[kind] += kept; exclusivity[`${kind}Dropped`] += all - kept; };
  const namedLevels = uniq(u.levels.map((x) => `${x.chain}|${x.level}`));
  const levels = namedLevels.filter((s) => onlyFor(tok, LEVEL_REQ.get(s))).map((s) => { const [chain, level] = s.split("|"); return { chain, level }; });
  count("levels", namedLevels.length, levels.length);
  const blockedLevels = uniq(u.blockedLevels.map((x) => `${x.chain}|${x.level}`)).filter((s) => closedTo(tok, LEVEL_REQ.get(s))).map((s) => { const [chain, level] = s.split("|"); return { chain, level }; });
  const named = new Map();
  for (const r of u.recruits) {
    const k = unitKey(r.unit);
    if (!named.has(k)) named.set(k, { type: r.unit, at: new Set() });
    named.get(k).at.add(`${r.chain}|${r.level}`);
  }
  // A unit is this culture's only if EVERY line that recruits it anywhere is.
  const units = new Map([...named].filter(([k]) => onlyFor(tok, RECRUITS_BY_UNIT.get(k) || [])));
  count("units", named.size, units.size);
  const blockedUnits = new Map();
  for (const r of u.blockedRecruits) {
    const k = unitKey(r.unit);
    if (!blockedUnits.has(k) && closedTo(tok, RECRUITS_BY_UNIT.get(k) || [])) blockedUnits.set(k, { type: r.unit });
  }
  const effectsOnly = u.effects.filter((e) => onlyFor(tok, e.requires));
  count("effects", u.effects.length, effectsOnly.length);
  return {
    tok, c, name: cultureName(tok), facs, held,
    levels, blockedLevels, units, blockedUnits,
    effects: groupEffects(effectsOnly), blockedEffects: groupEffects(u.blockedEffects.filter((e) => closedTo(tok, e.requires))),
    aliases: (aliasesNaming.get(tok) || []),
  };
}

const NOTHING_BUILD = (n) => `_No building level names this culture in its own \`requires\`._`;

function culturePage(f, all) {
  const { tok, c } = f;
  const name = f.name || tok;
  const facs = f.facs;
  const share = heldTotal ? (f.held / heldTotal) * 100 : 0;

  // Factions, largest first. The emblem is the thing a player recognises before the name.
  const facRows = facs
    .map((x) => ({ f: x, n: heldByFaction.get(x) || 0, rel: (FACTIONS[x] || {}).religion || null }))
    .sort((a, b) => b.n - a.n || facName(a.f).localeCompare(facName(b.f)));
  const tile = (x) => `${symbolFiles.has(x) ? `<img src="../symbols/${x}.png" alt="" width="24" height="24" style="vertical-align:middle"> ` : ""}${facLink(x)}`;
  const factionTable = facs.length
    ? `| Faction | Provinces at the start | Default belief |\n|---|---:|---|\n${facRows.map((r) => `| ${tile(r.f)} | ${r.n || "—"} | ${r.rel ? beliefRef(r.rel) : "_not determined_"} |`).join("\n")}`
    : null;

  // Beliefs its factions default to, as a distribution rather than a repeat of the column above.
  const byBelief = new Map();
  for (const r of facRows) {
    const k = r.rel || "";
    if (!byBelief.has(k)) byBelief.set(k, []);
    byBelief.get(k).push(r.f);
  }
  const beliefRows = [...byBelief.entries()]
    .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
    .map(([b, list]) => `| ${b ? beliefRef(b) : "_not determined_"} | ${list.length} | ${list.map((x) => facName(x)).join(", ")} |`);

  // Building levels, with this culture's own icon for each where one exists.
  const levels = f.levels.slice().sort((a, b) => levelName(a.level).localeCompare(levelName(b.level)));
  const levelRows = levels.map((l) => {
    const ic = iconFor(tok, l.level);
    return `| ${ic ? `<img src="../${ic}" alt="" width="64">` : ""} | ${levelLink(l.chain, l.level)} | ${chainLink(l.chain)} |`;
  });
  const levelTable = `| | Level | Chain |\n|:-:|---|---|\n${levelRows.join("\n")}`;
  const GOV_CHAIN = /^government/i;
  const govLevels = levels.filter((l) => GOV_CHAIN.test(l.chain));
  const otherLevels = levels.filter((l) => !GOV_CHAIN.test(l.chain));

  const units = [...f.units.values()].sort((a, b) => unitName(a.type).localeCompare(unitName(b.type)));
  const CARDS_UPTO = 24;
  const withCards = units.length <= CARDS_UPTO;
  const unitRows = units.map((x) => {
    const at = uniq([...x.at].map((s) => { const [chain, level] = s.split("|"); return levelLink(chain, level); })).join(", ");
    return withCards ? `| ${unitCard(x.type)} | ${unitLink(x.type)} | ${at} |` : `| ${unitLink(x.type)} | ${at} |`;
  });
  const unitTable = (withCards ? "| | Unit | Raised at |\n|:-:|---|---|\n" : "| Unit | Raised at |\n|---|---|\n") + unitRows.join("\n");

  const effRows = f.effects
    .slice().sort((a, b) => levelName(a.level).localeCompare(levelName(b.level)) || a.effect.localeCompare(b.effect))
    .map((e) => `| ${cell(effectRange(e))} | ${levelLink(e.chain, e.level)} |`);
  const blockedEffRows = f.blockedEffects
    .slice().sort((a, b) => levelName(a.level).localeCompare(levelName(b.level)) || a.effect.localeCompare(b.effect))
    .map((e) => `| ${cell(effectRange(e))} | ${levelLink(e.chain, e.level)} |`);

  // ── art and architecture ──
  const sm = SM_SETTLEMENTS.get(tok) || null;
  const declaredIcons = Object.entries(c.icons);
  const iconFamilies = uniq(declaredIcons.map(([, p]) => artFamily(p)).filter(Boolean));
  const iconsOnDisk = declaredIcons.filter(([, p]) => fs.existsSync(artPath(p))).length;
  const smSizes = sm ? [...sm.keys()] : [];
  const smMissing = LADDER.filter((s) => sm && !sm.has(s));
  const modelFamilies = sm ? uniq([...sm.values()].map((v) => {
    const m = /residences\/([a-z_]+?)_(village|town|large_town|city|large_city|huge_city)_/i.exec(String(v.normal || ""));
    return m ? m[1].toLowerCase() : null;
  }).filter(Boolean)) : [];
  const wallCount = sm ? [...sm.values()].reduce((a, v) => a + v.walls.length, 0) : 0;

  const artLines = [];
  if (sm) {
    artLines.push(`This culture has its own strategy-map buildings: **${smSizes.length}** of the ${LADDER.length} rungs have a block, with **${wallCount}** wall models between them${modelFamilies.length ? `, drawn from the \`${modelFamilies.join("`, `")}\` model set${modelFamilies.length === 1 ? "" : "s"}` : ""}.`);
    if (smMissing.length) {
      artLines.push(`**How far this culture's ladder goes is stated two ways.** It is given \`max settlement level: ${c.max || "not stated"}\`, which reaches ${sizeNameOf(c.max || LADDER[LADDER.length - 1])}, but there is no strategy-map block at ${smMissing.map(sizeNameOf).join(" or ")}, so no model and no card for ${smMissing.length === 1 ? "that rung" : "those rungs"}. Which of the two the engine obeys is **not determined**.`);
    } else {
      artLines.push(`Every rung of the ladder has a block, so nothing is missing between the two files for this culture.`);
    }
    artLines.push(fold(`What is drawn at each size (${smSizes.length})`, [
      "| Size | Buildings model | Wall models | UI card |",
      "|---|---|---:|---|",
      ...smSizes.map((s) => {
        const v = sm.get(s);
        return `| ${sizeRef(s)} | \`${(v.normal || "").split("/").pop() || "—"}\` | ${v.walls.length || "—"} | \`${(v.card || "").split("/").pop() || "—"}\` |`;
      }),
    ]));
  } else {
    artLines.push(`**This culture has no strategy-map buildings, walls or settlement card of its own.** Only **${SM_SETTLEMENTS.size}** of the ${CULTURES.length} cultures do: \`${[...SM_SETTLEMENTS.keys()].join("`, `")}\`. What its settlements are drawn with instead is **not determined**.`);
  }
  if (declaredIcons.length) {
    artLines.push(`This culture has a settlement card of its own for **${declaredIcons.length}** ${declaredIcons.length === 1 ? "size" : "sizes"}, from the \`${iconFamilies.join("`, `")}\` UI art ${iconFamilies.length === 1 ? "family" : "families"}${iconsOnDisk ? `, and ${iconsOnDisk} of those files ${iconsOnDisk === 1 ? "is" : "are"} in the mod folder` : `, and none of those files is in the mod folder; they come from the base game's own art`}.`);
  } else {
    artLines.push("_This culture has no settlement card of its own._");
  }
  if (c.fort && c.fort["card path"]) {
    artLines.push(`Its fort and watchtower are drawn from the same \`${artFamily(c.fort["card path"]) || "not determined"}\` art${c.watchtower && c.watchtower["base model"] ? `, with the \`${String(c.watchtower["base model"]).split("/").pop()}\` watchtower model` : ""}.`);
  }

  // ── the ladder ──
  const ladderDeclared = Object.keys(c.levels);
  const identical = all.every((o) => JSON.stringify(o.c.levels) === JSON.stringify(c.levels));

  const glance = [
    `**${facs.length}** faction${facs.length === 1 ? "" : "s"}`,
    `**${num(f.held)}** settlements at the start`,
    f.levels.length ? `**${f.levels.length}** building${f.levels.length === 1 ? "" : "s"} of its own` : null,
    f.units.size ? `**${f.units.size}** unit${f.units.size === 1 ? "" : "s"} of its own` : null,
  ].filter(Boolean).join(" · ");

  // Written for players (reworked 2026-09-26): what the culture means in a campaign. The file-
  // level detail it used to carry - model and card file names, the size ladder every culture
  // shares, portrait sets, the "civilised" flag, AI thresholds, empty sections - is gone.
  const buildLevels = [...govLevels, ...otherLevels];
  const ownLevelTable = (list) => `| | Building | Chain |\n|:-:|---|---|\n${list.map((l) => { const ic = iconFor(tok, l.level); return `| ${ic ? `<img src="../${ic}" alt="" width="64">` : ""} | ${levelLink(l.chain, l.level)} | ${chainLink(l.chain)} |`; }).join("\n")}`;
  const agentName = { spy: "Spy", assassin: "Assassin", diplomat: "Diplomat", merchant: "Merchant", admiral: "Admiral" };
  const costRows = [
    ...Object.entries(c.agents).filter(([, v]) => v["recruitment cost"]).map(([a, v]) => `| ${agentName[a] || a} | ${num(v["recruitment cost"])} dn |`),
    ...(c.fort && c.fort.cost ? [`| Fort | ${num(c.fort.cost)} dn |`] : []),
    ...(c.watchtower && c.watchtower.cost ? [`| Watchtower | ${num(c.watchtower.cost)} dn |`] : []),
  ];
  const sections = [];
  sections.push(`## Factions

${factionTable
    ? `**${facs.length}** ${facs.length === 1 ? "faction is" : "factions are"} ${name}, holding **${num(f.held)}** settlements at the start of the campaign (${share.toFixed(1)}% of the map).${facs.some((x) => NO_PAGE.has(x)) ? ` ${facs.filter((x) => NO_PAGE.has(x)).length === 1 ? "One of them is" : `${facs.filter((x) => NO_PAGE.has(x)).length} of them are`} not playable; see [factions you cannot play](../factions/non-playable.md).` : ""}

${maybeFold(`The ${facs.length} factions`, facs.length, factionTable)}`
    : `_No faction is of this culture._`}`);
  if (beliefRows.length) sections.push(`## What its factions believe

${facs.length === 1 ? "Its faction follows this belief." : byBelief.size === 1 ? `All ${facs.length} of its factions follow the same belief.` : `Its factions follow **${byBelief.size}** different beliefs: a culture does not decide a faction's religion.`}

| Belief | Factions | Who |
|---|---:|---|
${beliefRows.join("\n")}`);
  if (buildLevels.length) sections.push(`## Buildings only ${name} factions can build

**${buildLevels.length}** building ${buildLevels.length === 1 ? "level is" : "levels are"} open only to ${name} factions${govLevels.length ? `, including ${govLevels.length} government ${govLevels.length === 1 ? "level" : "levels"}` : ""}.

${maybeFold(`The ${buildLevels.length} buildings`, buildLevels.length, ownLevelTable(buildLevels))}`);
  if (f.blockedLevels.length) sections.push(`## Buildings ${name} factions cannot build

${f.blockedLevels.slice().sort((a, b) => levelName(a.level).localeCompare(levelName(b.level))).map((l) => levelLink(l.chain, l.level)).join(", ")}.`);
  if (units.length || f.blockedUnits.size) sections.push(`## ${units.length ? `Units only ${name} factions can raise` : `Units ${name} factions cannot raise`}

${units.length
    ? `**${units.length}** ${units.length === 1 ? "unit" : "units"} can be raised by ${name} factions and no others. A faction's full roster, and the regional units it can raise where it holds the right province, are on its own page.

${maybeFold(`The ${units.length} units`, units.length, unitTable)}`
    : ""}${f.blockedUnits.size ? `${units.length ? "\n\n" : ""}Being ${name} ${units.length ? "also " : ""}rules out ${f.blockedUnits.size === 1 ? "this unit" : "these units"}: ${[...f.blockedUnits.values()].map((x) => unitLink(x.type)).join(", ")}.` : ""}`);
  if (effRows.length || blockedEffRows.length) sections.push(`## Bonuses for being ${name}

${effRows.length
    ? `These bonuses apply in a settlement only when its owner is ${name}.

${maybeFold(`The ${effRows.length} bonuses`, effRows.length, `| Effect | Where |\n|---|---|\n${effRows.join("\n")}`)}`
    : ""}${blockedEffRows.length ? `\n\n${effRows.length ? "And these" : "These"} apply only when the owner is *not* ${name}:

${maybeFold(`The ${blockedEffRows.length} effects it misses out on`, blockedEffRows.length, `| Effect | Where |\n|---|---|\n${blockedEffRows.join("\n")}`)}` : ""}`);
  if (costRows.length) sections.push(`## Agents and forts

What it costs a ${name} faction to recruit an agent or put up a fort.

| | Cost |
|---|---:|
${costRows.join("\n")}`);

  const body = `${HEAD(name)}
${glance}

${sections.join("\n\n")}
`;
  fs.mkdirSync(path.join(OUT, "cultures"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "cultures", `${tok}.md`), body, "utf8");
  return f;
}

const FACTS = CULTURES.map(cultureFacts);
const PAGES = FACTS.map((f) => culturePage(f, FACTS));

// ── the anchor index ─────────────────────────────────────────────────────────
// Published from the side that WRITES the headings, exactly as tags/index.json and
// sizes/index.json are. A consumer reads the page name and the display name from here rather
// than humanising the token with its own copy of the rules — a one-character disagreement
// would send every link to a heading that is not there.
const INDEX = {};
for (const f of FACTS) INDEX[f.tok] = { page: `${f.tok}.md`, name: f.name || f.tok, anchor: anchor(f.name || f.tok) };
fs.mkdirSync(path.join(OUT, "cultures"), { recursive: true });
fs.writeFileSync(path.join(OUT, "cultures", "index.json"), JSON.stringify(INDEX, null, 1), "utf8");

// ── the index page ───────────────────────────────────────────────────────────
// ### and not ##, and for the reason written down in gen-ris-faction-pages.js: the viewer
// builds a page out of its H2s, boxing each into its own card, and 22 sections of the same
// shape become 22 windows stacked down the screen. With no H2 the content is left alone and
// reads as one list with the culture name as a divider, which is what it is.
const sorted = FACTS.slice().sort((a, b) => b.facs.length - a.facs.length || String(a.name).localeCompare(String(b.name)));
// "Own" counts only what is proved exclusive (onlyFor). A column empty for every culture - no
// culture has a unit of its own - is left out rather than printed as a column of dashes.
const HAS_OWN_LEVELS = FACTS.some((f) => f.levels.length);
const HAS_OWN_UNITS = FACTS.some((f) => f.units.size);
const summary = [
  // No Token column. It is the word the files use for this culture, which a player has no use
  // for — they see the name. Where the token still matters to someone reading the files, it is
  // on the culture's own page.
  `| Culture | Factions | Settlements |${HAS_OWN_LEVELS ? " Own buildings |" : ""}${HAS_OWN_UNITS ? " Own units |" : ""} Beliefs |`,
  `|---|---:|---:|${HAS_OWN_LEVELS ? "---:|" : ""}${HAS_OWN_UNITS ? "---:|" : ""}---:|`,
  ...sorted.map((f) => {
    const beliefs = uniq(f.facs.map((x) => (FACTIONS[x] || {}).religion).filter(Boolean)).length;
    return `| [${f.name || f.tok}](cultures/${f.tok}.md) | ${f.facs.length} | ${num(f.held)} |${HAS_OWN_LEVELS ? ` ${f.levels.length || "—"} |` : ""}${HAS_OWN_UNITS ? ` ${f.units.size || "—"} |` : ""} ${beliefs || "—"} |`;
  }),
].join("\n");
const ownCols = [HAS_OWN_LEVELS ? "**Own buildings**" : null, HAS_OWN_UNITS ? "**own units**" : null].filter(Boolean);

// Measured, not asserted: a culture counts as renamed when the mod's own name for it is not
// what knocking the underscores out of the token would have produced.
const RENAMED = CULTURE_TOKENS.filter(isRenamed);
const renameNote = RENAMED.length
  ? `**${RENAMED.length}** of the ${CULTURES.length} carry a name the token would not have produced: ${RENAMED.map((t) => `\`${t}\` is **${cultureName(t)}**`).join(", ")}, so the token is never printed as a name here. Every name on these pages is the mod's own, from its text files.`
  : `Every culture's name here is the mod's own, from its text files.`;

const biggestHolder = (() => {
  let best = null;
  for (const f of FACTS) for (const x of f.facs) {
    const n = heldByFaction.get(x) || 0;
    if (!best || n > best.n) best = { faction: x, n, culture: f };
  }
  return best;
})();

const indexBody = `# Cultures

[← all factions](factions.md) · [all regions and settlements](regions.md) · [beliefs](religions.md) · [wiki index](README.md)

Every faction belongs to a culture. On top of a faction's own roster, its culture decides some
of the buildings it can put up and the units it can raise, and what its agents and forts cost.
There are **${CULTURES.length}** cultures.

${summary}

**Settlements** is what the culture's factions hold at the start of the campaign.${ownCols.length ? ` ${ownCols.join(" and ")} ${ownCols.length === 1 ? "counts what" : "count what"} only that culture's factions can have.` : ""} **Beliefs**
is how many different religions its factions follow.
${biggestHolder && biggestHolder.n / heldTotal > 0.2
    ? `\nThe **${facName(biggestHolder.faction)}** (land no faction holds at the start) count as ${biggestHolder.culture.name ? `**${biggestHolder.culture.name}**` : biggestHolder.culture.tok}, which is why that row has ${num(biggestHolder.n)} settlements.\n`
    : ""}`;
fs.writeFileSync(path.join(OUT, "cultures.md"), indexBody, "utf8");

// ── report ───────────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
say(`culture pages -> ${path.join(OUT, "cultures")} (+ cultures.md, cultures/index.json)`);
say(`  the vocabulary, derived three ways — all three must agree:`);
say(`    descr_cultures.txt blocks at one tab of indent:        ${CULTURES.length}  (${CULTURE_TOKENS.join(", ")})`);
say(`    distinct "culture" values in descr_sm_factions.txt:    ${culturesAssigned.length}`);
say(`    culture tokens found inside a factions{} clause in EDB:${String(CULTURES_IN_LISTS.length).padStart(3)}`);
say(`    ${CULTURES.length === culturesAssigned.length && CULTURES.length === CULTURES_IN_LISTS.length ? "the three AGREE" : "THE THREE DISAGREE — see the lists above"}`);
say(`  descr_sm_factions.txt: ${Object.keys(FACTIONS).length} faction blocks by the block walk, ${RAW_CULTURE_LINES} "culture" lines by a flat pattern  <- must match`);
say(`    ${Object.keys(FACTIONS).length === RAW_CULTURE_LINES ? "the two counts AGREE" : "THE TWO COUNTS DISAGREE — a faction block is being lost"}`);
say(`    per culture, block walk vs flat pattern: ${CULTURE_TOKENS.map((t) => `${t} ${factionsOf(t).length}/${RAW_CULTURE_COUNTS[t] || 0}`).join(", ")}`);
say(`    factions with no culture line: ${factionsWithNoCulture.length}${factionsWithNoCulture.length ? ` (${factionsWithNoCulture.join(", ")})` : ""}`);
say(`  display names: ${CULTURE_TOKENS.filter((t) => ALL_TEXT[t]).length}/${CULTURES.length} via the bare {<culture>} entry, ${CULTURE_TOKENS.filter((t) => ALL_TEXT[`${t}_label`]).length} also have {<culture>_label}, ${CULTURE_TOKENS.filter((t) => ALL_TEXT[`ui_${t}`]).length} also have {UI_<CULTURE>}`);
{
  const disagree = CULTURE_TOKENS.filter((t) => ALL_TEXT[t] && ALL_TEXT[`${t}_label`] && ALL_TEXT[t] !== ALL_TEXT[`${t}_label`]);
  say(`    bare vs _label, where both exist: ${disagree.length ? `DISAGREE on ${disagree.join(", ")}` : "agree everywhere"}`);
}
say(`    names the token would NOT have produced: ${CULTURE_TOKENS.filter(isRenamed).length} — ${CULTURE_TOKENS.filter(isRenamed).map((t) => `${t} -> ${cultureName(t)}`).join(", ")}`);
for (const [tok, bare, ui] of cultureRenames) say(`    menu_english disagrees with the shown name for \`${tok}\`: shown as "${bare}", {UI_…} says "${ui}"`);
if (cultureNamed.none.length) say(`    NO DISPLAY NAME, token printed: ${cultureNamed.none.join(", ")}`);
say(`\n  export_descr_buildings.txt, the culture gate:`);
say(`    the word "culture" inside a requires expression: ${CULTURE_KEYWORD_CLAUSES}  <- the mechanism is the faction list, not a keyword`);
say(`    factions{}/building_factions{} clauses read: ${num(listClauses)} · distinct tokens in them: ${ALL_LIST_TOKENS.size}`);
say(`      of those, faction tokens ${[...ALL_LIST_TOKENS].filter((t) => FACTION_TOKENS.has(t)).length}, "all" ${ALL_LIST_TOKENS.has("all") ? 1 : 0}, culture tokens ${CULTURES_IN_LISTS.length}, unclassified ${LIST_UNCLASSIFIED.length}${LIST_UNCLASSIFIED.length ? ` (${LIST_UNCLASSIFIED.join(", ")})` : ""}`);
say(`      cultures that are ALSO faction tokens: ${CULTURES_ALSO_FACTIONS.length}${CULTURES_ALSO_FACTIONS.length ? ` (${CULTURES_ALSO_FACTIONS.join(", ")}) <- these would be ambiguous` : "  <- so no token is ambiguous"}`);
say(`    aliases scanned for a culture one indirection away: ${Object.keys(ALIASES).length} · naming at least one: ${aliasesNaming.size ? [...aliasesNaming.values()].reduce((a, v) => a + v.length, 0) : 0} alias/culture pairs`);
say(`    "only this culture", proved by evaluating each gate for all ${EVAL_FACTIONS.length} factions: levels ${exclusivity.levels} kept / ${exclusivity.levelsDropped} shared with others, units ${exclusivity.units} / ${exclusivity.unitsDropped}, bonuses ${exclusivity.effects} / ${exclusivity.effectsDropped}`);
say(`    per culture, levels/blocked/units/effects/blocked-effects:`);
for (const f of FACTS) {
  say(`      ${f.tok.padEnd(15)} ${String(f.levels.length).padStart(3)} ${String(f.blockedLevels.length).padStart(3)} ${String(f.units.size).padStart(4)} ${String(f.effects.length).padStart(4)} ${String(f.blockedEffects.length).padStart(4)}   ${f.facs.length} factions, ${num(f.held)} provinces`);
}
{
  const dead = FACTS.filter((f) => !f.levels.length && !f.blockedLevels.length && !f.units.size && !f.effects.length && !f.blockedEffects.length);
  say(`    cultures the buildings file conditions on nowhere at all: ${dead.length}${dead.length ? ` (${dead.map((f) => f.tok).join(", ")})` : ""}`);
}
if (unknownEffects.size) say(`    effect kinds with no wording (printed as the raw key): ${[...unknownEffects].map(([k, n]) => `${k} x${n}`).join(", ")}`);
say(`\n  campaign start, counted twice:`);
say(`    descr_strat parser: ${num(heldTotal)} settlements · flat "level <x>" pattern over the same file: ${num(RAW_SETTLEMENT_LINES)}`);
say(`    ${heldTotal === RAW_SETTLEMENT_LINES ? "the two counts AGREE" : "THE TWO COUNTS DISAGREE"}`);
say(`    sum of the per-culture province counts: ${num(FACTS.reduce((a, f) => a + f.held, 0))} of ${num(heldTotal)}${FACTS.reduce((a, f) => a + f.held, 0) === heldTotal ? " — every settlement is accounted for" : " — SETTLEMENTS ARE MISSING FROM THE CULTURE TOTALS"}`);
say(`    regions in descr_regions.txt: ${num(REGION_COUNT)}`);
say(`\n  settlement art:`);
say(`    descr_sm_settlements.txt blocks: ${SM_SETTLEMENTS.size} of ${CULTURES.length} cultures (${[...SM_SETTLEMENTS.keys()].join(", ")})`);
{
  const short = [...SM_SETTLEMENTS.entries()].filter(([, m]) => LADDER.some((s) => !m.has(s)));
  say(`    of those, stopping short of the ${LADDER.length}-rung ladder: ${short.length}${short.length ? ` (${short.map(([t, m]) => `${t} up to ${[...m.keys()].pop()}`).join(", ")})` : ""}`);
  say(`    descr_cultures.txt "max settlement level": ${uniq(CULTURES.map((c) => c.max)).join(", ")} for all ${CULTURES.length}`);
  say(`    <- CONTRADICTION, reported on the pages and not resolved: the two files disagree for ${short.length} culture(s)`);
}
{
  const fams = uniq(CULTURES.flatMap((c) => Object.values(c.icons).map(artFamily).filter(Boolean)));
  const onDisk = CULTURES.reduce((a, c) => a + Object.values(c.icons).filter((p) => fs.existsSync(artPath(p))).length, 0);
  const declared = CULTURES.reduce((a, c) => a + Object.keys(c.icons).length, 0);
  say(`    descr_cultures.txt settlement cards: ${declared} declared across ${fams.length} art families (${fams.join(", ")}), ${onDisk} of them files in the mod folder`);
}
say(`\n  links into other page families (absent families cost pictures and links, never facts):`);
say(`    faction pages ${factionPages.size} · symbols ${symbolFiles.size} · building chain pages ${buildingPages.size} · unit pages ${unitPages.size} · unit cards ${cardFiles.size}`);
say(`    building icons keyed <culture>/<level>: ${Object.keys(ICONS).length} entries covering ${uniq(Object.keys(ICONS).map((k) => k.split("/")[0])).length} cultures${CULTURE_TOKENS.filter((t) => !Object.keys(ICONS).some((k) => k.startsWith(`${t}/`))).length ? `; none for ${CULTURE_TOKENS.filter((t) => !Object.keys(ICONS).some((k) => k.startsWith(`${t}/`))).join(", ")}` : ""}`);
say(`    settlement sizes linked: ${sizeLinked} (${Object.keys(SIZE_INDEX).length} in sizes/index.json)${Object.keys(SIZE_INDEX).length ? "" : "  <- run gen-ris-settlement-sizes.js, then this generator again"}`);
say(`    beliefs linked: ${beliefLinked} (${Object.keys(RELIGION_INDEX).length} in religions/index.json)${Object.keys(RELIGION_INDEX).length ? "" : "  <- run gen-ris-belief-pages.js, then this generator again"}`);
say(`    display names: ${levelNameMisses} building levels with no text entry, ${unitNameMisses} units with no name`);
say(`\n  pages written: ${PAGES.length} under cultures/, plus cultures.md and cultures/index.json`);
say(`  NEXT: run gen-ris-faction-pages.js and gen-ris-region-pages.js so their culture values link here`);
