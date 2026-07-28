#!/usr/bin/env node
/**
 * A reference page per TRADE GOOD, plus the index that lists them all.
 *
 *   node scripts/gen-ris-trade-goods.js [--ris <dir>] [--out <dir>]
 *
 * A region page says "Trade goods: Grain, Sheep, Salt" and every one of those was a dead end.
 * These pages answer the three questions a player actually has about a good — what it is,
 * where it is, and what it does for you — and nothing else, because nothing else is
 * established anywhere in the files.
 *
 * WHAT IT IS comes from descr_sm_resources.txt, which declares each good's subtype, tier,
 * trade value, tag groups, icon, and the localised keys for its name and tooltip.
 *
 * TWO TRAPS IN THAT FILE, both of which produced a wrong page before they were found:
 *
 *   1. THE `name` KEY IS NOT DERIVED FROM THE TOKEN. RIS reuses vanilla resource slots under
 *      new names, and the mapping is not the identity — token `horses` declares
 *      "SMT_RESOURCE_FURS", `salt` declares "SMT_RESOURCE_DOG", `fish` declares
 *      "SMT_RESOURCE_PIG", and mineable `coal` reuses "TMT_IRON_MINE_TOOLTIP" for its mining
 *      tooltip. Looking up `smt_resource_<token>` misses all of them. The key the block
 *      declares for itself is the only one read here.
 *
 *   2. FOUR GOODS HAVE THEIR `tier` COMMENTED OUT. `slaves`, `villages`, `shipwrecks` and
 *      `aqueduct` carry `;"tier": 0,` — a semicolon comment in RTW syntax, so the game never
 *      sees it. A field regex run over the raw block text happily reads the 0 back and
 *      publishes a tier that is not declared. Comments are stripped line by line before any
 *      field is read, and those four are reported as **not declared** instead of as tier 0.
 *
 * The text files are UTF-16LE, so grep finds nothing in them and they must be read with the
 * encoding stated. All 46 goods resolve both a name and a tooltip in text/resources.txt.
 *
 * WHERE IT IS FOUND comes from the 5,547 `resource <type>, <qty>, <x>, <y>` placements in
 * descr_strat.txt, each mapped to a region through map_regions.tga exactly as
 * gen-ris-region-pages.js does. Every per-good region set is then CROSS-CHECKED against the
 * region named in each placement line's own trailing comment, which is an entirely
 * independent derivation: the two agree for all 42 placed goods, and any good where they
 * disagreed would be published as "not determined" rather than guessed.
 *
 * WHAT IT DOES is read off every clause in export_descr_buildings.txt that conditions on
 * `resource <token>` — building levels it permits, numeric effects it keys, and recruit lines
 * it gates — including the ones reached one indirection away through an `alias`. Negated
 * clauses count: withholding something is an effect. Where nothing in the files conditions on
 * a good the page says so, which is a real finding about five of the forty-six and not a gap
 * to hide.
 *
 * COUNT UNITS, NOT RECRUIT LINES. Three goods gate troops, and the two figures are nothing
 * like each other: `resource horses` appears on 686 recruit lines but only 98 distinct units,
 * `resource elephants` on 164 lines and 5 units, `resource camels` on 56 lines and 5. A unit
 * is restated once per building level that can raise it, so the line count says how many
 * places you can raise something, not how many things there are. The pages report the DISTINCT
 * units, keyed on each unit's EDU `dictionary` so two entries for the same unit collapse — and
 * the numbers above are here because reading 164 as "33 elephant units" is the mistake this
 * paragraph exists to stop, one already made once in a commit message for this generator.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };
// Matches both GitHub's heading-anchor rule and the local viewer's slugId(), which is the
// pair that has to agree or an in-page link breaks in one of the two places.
const anchor = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const L = require(path.join(__dirname, "lib", "edbRecruit.js"));
const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));

// ── descr_sm_resources ───────────────────────────────────────────────────────
/**
 * Top-level resource blocks, found by BRACE DEPTH rather than by a lazy regex, and with
 * comments stripped first. Both matter:
 *   - depth, because every block contains a nested `"quantity models": { … }` and a lazy
 *     `\{ … \n\s*\}` stops at the inner brace;
 *   - comments, because four blocks comment out their `tier` line and a raw read publishes
 *     the commented number as if it were declared.
 * The block COUNT is cross-checked against the lazy regex the other generators use, and the
 * run reports both.
 */
function parseResourceBlocks(txt) {
  const lines = txt.split(/\r?\n/);
  const out = [];
  let depth = 0, name = null, cur = null;
  for (const raw of lines) {
    const line = raw.replace(/;.*$/, "");           // RTW comments run to end of line
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    const m = /^\s*"([A-Za-z0-9_\-]+)"\s*:\s*$/.exec(line);
    if (m && depth === 0 && m[1].toLowerCase() !== "resources") name = m[1];
    if (depth === 0 && opens > 0 && name) cur = { name, body: [] };
    if (cur) cur.body.push(line);
    depth += opens - closes;
    if (cur && depth === 0) { out.push({ name: cur.name, body: cur.body.join("\n") }); cur = null; name = null; }
  }
  return out;
}

const RES_TXT = rd("descr_sm_resources.txt") || "";
const BLOCKS = parseResourceBlocks(RES_TXT);
// Second, independent count of the same thing, using the pattern gen-ris-region-pages.js and
// gen-ris-tag-pages.js already run over this file. Reported side by side below.
const BLOCKS_VIA_REGEX = [...RES_TXT.matchAll(/"([A-Za-z0-9_\-]+)"\s*:\s*\{([\s\S]*?)\n\s*\}/g)]
  .filter((m) => m[1].toLowerCase() !== "resources").length;

const str = (b, key) => { const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(b); return m ? m[1] : null; };
const num = (b, key) => { const m = new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`).exec(b); return m ? parseInt(m[1], 10) : null; };
const bool = (b, key) => { const m = new RegExp(`"${key}"\\s*:\\s*(true|false)`).exec(b); return m ? m[1] === "true" : null; };

const GOODS = [];         // the non-hidden resources, in file order
let hiddenCount = 0;
for (const b of BLOCKS) {
  const subtype = str(b.body, "subtype");
  if (subtype === "hidden") { hiddenCount++; continue; }
  const tagsM = /"tags"\s*:\s*\[([^\]]*)\]/.exec(b.body);
  GOODS.push({
    tok: b.name.toLowerCase(),
    subtype,
    tier: num(b.body, "tier"),
    tradeValue: num(b.body, "trade value"),
    nameKey: (str(b.body, "name") || "").toLowerCase() || null,
    tipKey: (str(b.body, "tooltip") || "").toLowerCase() || null,
    mineTipKey: (str(b.body, "mining tooltip") || "").toLowerCase() || null,
    icon: str(b.body, "icon"),
    tags: tagsM ? tagsM[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean) : [],
    depletable: bool(b.body, "depletable"),
    baseTurns: num(b.body, "base turns"),
    popImpact: num(b.body, "pop impact"),
  });
}

// ── display names and tooltips ───────────────────────────────────────────────
// text/resources.txt is UTF-16LE. It is also the file RIS OVERRIDES: it renames the vanilla
// slots (SMT_RESOURCE_FURS reads "Horses" here and "Furs" in text/strat.txt, which still
// carries the vanilla set). resources.txt is therefore the one read, and every key every good
// declares is present in it — the counters below would say so if that stopped being true.
function loadText(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* the token stands on its own */ }
  return map;
}
const RESOURCE_TEXT = loadText("resources.txt");
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

/** The game's own string for a declared key, or null. `\n` is an escape in the text file. */
const textOf = (key) => {
  const v = key ? RESOURCE_TEXT[key] : null;
  return v ? v.replace(/\\n/g, " ").replace(/\s+/g, " ").trim() : null;
};
const humanise = (tok) => String(tok).replace(/_+/g, " ").replace(/^./, (c) => c.toUpperCase());

let nameHits = 0, tipHits = 0, tipEchoes = 0, mineTipHits = 0, mineTipDeclared = 0;
const nameMisses = [], tipMisses = [];
for (const g of GOODS) {
  g.name = textOf(g.nameKey);
  if (g.name) nameHits++; else { nameMisses.push(g.tok); g.name = humanise(g.tok); }
  g.tooltip = textOf(g.tipKey);
  if (g.tooltip) tipHits++; else tipMisses.push(`${g.tok} -> ${g.tipKey}`);
  // A tooltip that only repeats the display name tells a reader nothing, and printing it
  // under the name as though it were a description would be padding. Counted, and shown only
  // when it says something the name does not.
  if (g.tooltip && g.tooltip.toLowerCase() === String(g.name).toLowerCase()) { tipEchoes++; g.tooltipAdds = false; }
  else g.tooltipAdds = !!g.tooltip;
  if (g.mineTipKey) { mineTipDeclared++; g.mineTooltip = textOf(g.mineTipKey); if (g.mineTooltip) mineTipHits++; }
}

// ── where each good is placed ────────────────────────────────────────────────
// `resource <type>, <quantity>, <x>, <y>   ; <region>` — four numeric-ish fields, and the
// SECOND is the quantity, not the x coordinate. The coordinate convention is the one
// gen-ris-region-pages.js measured: descr_strat y indexes the TGA's storage row directly,
// because RTW counts y from the bottom of the map and the TGA is stored bottom-up.
//
// A marker's own tile is painted its own colour, so a small neighbourhood is sampled and the
// commonest region colour wins rather than a single pixel being read.
//
// EVERY REGION SET IS DERIVED TWICE. Once through the TGA as above, and once from the region
// each placement line names in its own trailing comment — which is not the same evidence, and
// is the check that a coordinate convention has not silently drifted. A good whose two sets
// disagree is published as "not determined".
function loadPlacements() {
  const perGood = new Map();   // tok -> { markers, quantity, byRegion: Map(region -> {markers, quantity}) }
  const noteSets = new Map();  // tok -> Set(region), derived from the trailing comments only
  const stats = { lines: 0, altLines: 0, unresolved: 0, noNote: 0, noteUnknown: 0 };

  let strat, parsed, tga;
  try {
    strat = fs.readFileSync(path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"), "latin1");
    parsed = dg.parseDescrRegions(fs.readFileSync(path.join(RIS, "world", "maps", "base", "descr_regions.txt"), "latin1"));
    tga = dg.tgaToRaw(fs.readFileSync(path.join(RIS, "world", "maps", "base", "map_regions.tga")));
  } catch { return { perGood, noteSets, stats }; }

  const rgbToRegion = parsed.rgbToRegion, regionToCity = parsed.regionToCity;
  const byLowerRegion = {}, byLowerCity = {};
  for (const [r, c] of Object.entries(regionToCity)) { byLowerRegion[r.toLowerCase()] = r; byLowerCity[String(c).toLowerCase()] = r; }

  const regionAt = (x, y) => {
    if (x < 0 || y < 0 || x >= tga.W || y >= tga.H) return null;
    const i = (y * tga.W + x) * 3;
    return rgbToRegion[`${tga.raw[i + 2]},${tga.raw[i + 1]},${tga.raw[i]}`] || null;
  };
  const regionNear = (x, y) => {
    const votes = new Map();
    for (let r = 0; r <= 3; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const reg = regionAt(x + dx, y + dy);
        if (reg) votes.set(reg, (votes.get(reg) || 0) + 1);
      }
      if (votes.size) break;
    }
    let best = null, n = 0;
    for (const [reg, c] of votes) if (c > n) { best = reg; n = c; }
    return best;
  };

  // Second, independent count of how many placement lines there are at all, so a tightening of
  // the field pattern above cannot silently drop some without the run saying so.
  stats.altLines = (strat.match(/^resource\s+/gim) || []).length;

  for (const m of strat.matchAll(/^resource\s+([a-z_]+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:;\s*(.*))?$/gim)) {
    stats.lines++;
    const tok = m[1].toLowerCase();
    const qty = parseInt(m[2], 10);
    if (!perGood.has(tok)) perGood.set(tok, { markers: 0, quantity: 0, byRegion: new Map() });
    if (!noteSets.has(tok)) noteSets.set(tok, new Set());
    const e = perGood.get(tok);
    e.markers++;
    e.quantity += Number.isFinite(qty) ? qty : 0;

    const reg = regionNear(+m[3], +m[4]);
    if (reg) {
      const r = e.byRegion.get(reg) || { markers: 0, quantity: 0 };
      r.markers++; r.quantity += Number.isFinite(qty) ? qty : 0;
      e.byRegion.set(reg, r);
    } else stats.unresolved++;

    const note = (m[5] || "").trim();
    if (!note) { stats.noNote++; continue; }
    const r2 = byLowerRegion[note.toLowerCase()] || byLowerCity[note.toLowerCase()] || null;
    if (r2) noteSets.get(tok).add(r2); else stats.noteUnknown++;
  }
  return { perGood, noteSets, stats };
}
const PLACED = loadPlacements();

// The two derivations, compared per good. `regionsAgree` is what decides whether a region
// COUNT is published at all.
let goodsAgreeing = 0;
const goodsDisagreeing = [];
for (const g of GOODS) {
  const e = PLACED.perGood.get(g.tok);
  g.markers = e ? e.markers : 0;
  g.quantity = e ? e.quantity : 0;
  g.byRegion = e ? e.byRegion : new Map();
  const viaTga = new Set(g.byRegion.keys());
  const viaNote = PLACED.noteSets.get(g.tok) || new Set();
  g.regionsAgree = viaTga.size === viaNote.size && [...viaTga].every((r) => viaNote.has(r));
  if (!e) { g.regionsAgree = true; continue; }          // no placements: nothing to disagree about
  if (g.regionsAgree) goodsAgreeing++;
  else goodsDisagreeing.push(`${g.tok}: ${viaTga.size} via the map, ${viaNote.size} via the line's own comment`);
}

// ── who holds it at the campaign start ───────────────────────────────────────
// parseStrat returns faction -> { settlements: [ { region, … } ] }, so it must be inverted
// before a region can be asked who owns it.
const STRAT = gv.parseStrat(path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt")) || {};
const OWNER_OF = new Map();
for (const [fac, v] of Object.entries(STRAT)) for (const s of (v.settlements || [])) OWNER_OF.set(s.region, fac);
// Must match the exclusion set in gen-ris-faction-pages.js: these have no page, and ~1,000
// regions are held by `slave` at the campaign start.
const NO_PAGE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
// `slave` is the rebel/unaligned pool and holds more regions than any real faction, so on a
// per-good ownership table it is the first row almost every time. It has no
// IMPERIAL_CAMPAIGN_…_TITLE, because it is not a campaign you can pick — but the game does
// name it: text/shared.txt carries `{ST_SLAVES}Rebels`, which is the label RTW shows for it.
// That is a declared string, not a gloss invented here.
const SHARED_TEXT = loadText("shared.txt");
const facName = (f) => {
  const t = String(f).toLowerCase();
  if (t === "slave" && SHARED_TEXT.st_slaves) return SHARED_TEXT.st_slaves;
  return FACTION_NAMES[t] || String(f).replace(/_/g, " ");
};
const facRef = (f) => (NO_PAGE.has(String(f).toLowerCase())
  ? facName(f)
  : `[${facName(f)}](../factions/${f}.md)`);

// ── what each good does ──────────────────────────────────────────────────────
const EDB_TXT = rd("export_descr_buildings.txt") || "";
if (!EDB_TXT) { console.error("export_descr_buildings.txt not found"); process.exit(2); }
const ALIASES = L.parseAliases(EDB_TXT);
const EDB = L.parseEdb(EDB_TXT);
const USAGE = L.resourceUsage(EDB, ALIASES);

const EDU_DICT = (() => {
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
const dirSet = (sub) => {
  try { return new Set(fs.readdirSync(path.join(OUT, sub)).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
};
const unitPages = dirSet("units");
const buildingPages = dirSet("buildings");
const regionPages = dirSet("regions");
const uSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

let unitNameMisses = 0, levelNameMisses = 0;
function unitLink(type) {
  const dict = EDU_DICT[String(type).toLowerCase()];
  const name = dict ? UNIT_TEXT[dict] : null;
  if (!name) unitNameMisses++;
  const label = name || String(type).replace(/\b\w/g, (c) => c.toUpperCase());
  const p = dict ? uSlug(dict) : null;
  return p && unitPages.has(p) ? `[**${label}**](../units/${p}.md)` : `**${label}**`;
}
const unitKey = (type) => EDU_DICT[String(type).toLowerCase()] || `type:${String(type).toLowerCase()}`;
const unitName = (type) => {
  const d = EDU_DICT[String(type).toLowerCase()];
  return (d && UNIT_TEXT[d]) || String(type).replace(/\b\w/g, (c) => c.toUpperCase());
};
function levelLink(chain, level) {
  const name = BUILDING_NAMES[String(level).toLowerCase()];
  if (!name) levelNameMisses++;
  const label = name || String(level).replace(/_/g, " ");
  const p = String(chain).toLowerCase();
  return buildingPages.has(p) ? `[${label}](../buildings/${p}.md)` : label;
}
const levelName = (level) => BUILDING_NAMES[String(level).toLowerCase()] || String(level).replace(/_/g, " ");
// The region TOKEN is not its name. The mod localises all 1,311 of them in
// text/imperial_campaign_regions_and_settlement_names.txt, and for three of them the answer is
// not the token with its underscores knocked out: `Odrysia` is called "Basilike Brenaia",
// `Lusonia_Septentrionalis` is "Lusonia Iberica", `Boreios_Labeataia` is "Boreia Labeataia".
// The link target stays the token, because that is the file name.
const REGION_NAMES = (() => {
  const out = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", "imperial_campaign_regions_and_settlement_names.txt"), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) out[m[1].trim()] = m[2].trim();
  } catch { /* fall back to the token */ }
  return out;
})();
const regionName = (r) => REGION_NAMES[r] || String(r).replace(/_/g, " ");
const regionLink = (r) => (regionPages.has(r) ? `[${regionName(r)}](../regions/${encodeURIComponent(r)}.md)` : regionName(r));

// Wording for every effect kind a `resource` clause is actually keyed to. Taken from the file
// rather than written from memory — those fourteen are trade_base_income_bonus, farming_level,
// taxable_income_bonus, law_bonus, happiness_bonus, population_health_bonus,
// population_growth_bonus, mine_resource, stage_races, armour and the four weapon_ kinds.
// Anything new falls through to the raw key and is reported at the end of the run.
const sgn = (n) => (n >= 0 ? `+${n}` : String(n));
const EFFECT_WORDS = {
  trade_base_income_bonus: (n) => `trade income ${sgn(n)}`,
  taxable_income_bonus: (n) => `taxable income ${sgn(n)}`,
  farming_level: (n) => `farming level ${sgn(n)}`,
  law_bonus: (n) => `public order (law) ${sgn(n)}`,
  happiness_bonus: (n) => `public order (happiness) ${sgn(n)}`,
  population_health_bonus: (n) => `population health ${sgn(n)}`,
  population_growth_bonus: (n) => `population growth ${sgn(n)}`,
  mine_resource: (n) => `mine income ${sgn(n)}`,
  stage_races: (n) => `may stage races (${sgn(n)})`,
  armour: (n) => `armour upgrade ${sgn(n)}`,
  weapon_simple: (n) => `simple weapon upgrade ${sgn(n)}`,
  weapon_bladed: (n) => `bladed weapon upgrade ${sgn(n)}`,
  weapon_missile: (n) => `missile weapon upgrade ${sgn(n)}`,
  weapon_other: (n) => `other weapon upgrade ${sgn(n)}`,
  religious_belief: (n, subject) => `${subject ? subject.replace(/_/g, " ") : "religious"} belief ${sgn(n)}`,
};
const unknownEffects = new Set();
function effectWords(e, amount) {
  const n = amount == null ? e.amount : amount;
  const f = EFFECT_WORDS[e.effect];
  if (!f) { unknownEffects.add(e.effect); return `\`${e.effect}\` ${sgn(n)}`; }
  return f(n, e.subject);
}
/** "trade income +2", or "trade income +2 to +4" where one level declares several amounts. */
function effectRange(e) {
  if (e.min == null || e.min === e.max) return effectWords(e, e.min);
  return `${effectWords(e, e.min)} to ${sgn(e.max)}`;
}

const uniq = (a) => [...new Set(a)];
function factsFor(tok) {
  const u = USAGE.get(tok) || { levels: [], recruits: [], effects: [], aliases: [], blockedLevels: [], blockedRecruits: [], blockedEffects: [] };
  const pair = (arr) => uniq(arr.map((x) => `${x.chain}|${x.level}`)).map((s) => s.split("|"));
  const units = new Map();
  for (const r of u.recruits) {
    const k = unitKey(r.unit);
    if (!units.has(k)) units.set(k, { type: r.unit, levels: new Set() });
    units.get(k).levels.add(`${r.chain}|${r.level}`);
  }
  const blockedUnits = new Set(u.blockedRecruits.map((r) => unitKey(r.unit)));
  // Grouped by WHAT the effect is and WHERE, and stated as a range when one level declares the
  // same effect at several amounts — which many do, because the amount is crossed with a
  // second condition. Listing those separately reads as a contradiction.
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
  return {
    levels: pair(u.levels), blockedLevels: pair(u.blockedLevels),
    units, blockedUnits, effects: group(u.effects), blockedEffects: group(u.blockedEffects),
    aliases: u.aliases,
  };
}
for (const g of GOODS) g.facts = factsFor(g.tok);

// ── icons ────────────────────────────────────────────────────────────────────
// Written by gen-ris-region-pages.js, from the icon path each resource declares for itself.
// Not duplicated here — one generator owning a file is what keeps the collision check
// meaningful — but every missing one is named in the report, because a good with no icon is a
// blank cell on the index table and nothing else would say why.
const iconFiles = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "resource-icons")).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""))); }
  catch { return new Set(); }
})();
const iconImg = (tok, up, size) => (iconFiles.has(tok)
  ? `<img src="${up}resource-icons/${tok}.png" alt="" width="${size || 24}">` : "");

// ── prose the pages share ────────────────────────────────────────────────────
// Folded. This is the page's warranty rather than its content — how the "what it does" lines
// were arrived at, and why a good with nothing behind it is reported as such instead of being
// described from its name. Kept, because it is the reason the page can be trusted; folded,
// because a reader looking up what Amber is worth should not have to read about clause parsing
// to get there. `extra` is where a page adds a fact of the same kind, such as a good's internal
// token, which is no use in play but is the identifier a modder needs.
const provenance = (extra) => [
  "<details>",
  "<summary>Where these answers come from, and what an unestablished effect means</summary>",
  "",
  "What a good **does** is read off the clauses the mod conditions on it — a requirement on a " +
  "building level, on a numeric effect, or on a recruitment line, including the ones reached " +
  "through the building file's own aliases. Negated clauses count: withholding something is an " +
  "effect. Where nothing in the mod conditions on a good, the page says **no effect " +
  "established** rather than describing what the word suggests.",
  ...(extra ? ["", extra] : []),
  "",
  "</details>",
].join("\n");
const PROVENANCE = provenance(null);

const SUBTYPE_WORDS = {
  mineable: "**Mineable** — the mines chain can be built at the settlement that holds it.",
  slaves: "**Slaves** — the engine's own slave resource, created when a settlement is enslaved.",
  none: "**Ordinary trade good** — no special engine handling; it works through trade and through what the mod conditions on it.",
};

// "Nothing conditions on this good" is a strong enough claim that it is checked everywhere a
// resource could be read, not only in the obvious file. These are the remaining consumers: the
// campaign script and the spawn scripts can test one, the mercenary pools and the rebel-faction
// blocks can name one. Same list gen-ris-tag-pages.js uses for the same reason.
//
// Two searches per good, deliberately different in strictness. The CLAUSE search looks for
// `resource <good>`, which is what would actually gate something. The plain TOKEN search is
// looser and can only weaken the claim to "named somewhere else, go and look" — never
// strengthen it — so a false positive there is harmless and a false negative is not possible.
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
function otherConsumerHits(tok) {
  const safe = String(tok).replace(/[^a-z0-9_]/gi, "");
  const clause = new RegExp(`\\bresource[ \\t]+${safe}\\b`, "i");
  const plain = new RegExp(`\\b${safe}\\b`, "i");
  const out = { clause: [], plain: [] };
  for (const [p, t] of OTHER_CONSUMERS) {
    if (clause.test(t)) out.clause.push(path.basename(p));
    else if (plain.test(t)) out.plain.push(path.basename(p));
  }
  return out;
}

const NOTHING = "**No effect established in the mod files.** Nothing in the mod requires it, " +
  "excludes it, or keys a number off it.";

// ── one good's page ──────────────────────────────────────────────────────────
fs.mkdirSync(path.join(OUT, "goods"), { recursive: true });

const stats = { withEffect: 0, withoutEffect: 0, withUnits: 0, unplaced: 0, iconMissing: [] };

function goodPage(g) {
  const f = g.facts;
  const nRegions = g.byRegion.size;
  const hasEffect = !!(f.levels.length || f.blockedLevels.length || f.effects.size
    || f.blockedEffects.size || f.units.size || f.blockedUnits.size);
  if (hasEffect) stats.withEffect++; else stats.withoutEffect++;
  if (f.units.size) stats.withUnits++;
  if (!g.markers) stats.unplaced++;
  if (!iconFiles.has(g.tok)) stats.iconMissing.push(g.tok);

  // ── identity ──
  const rows = [];
  rows.push(`| Subtype | ${SUBTYPE_WORDS[g.subtype] || (g.subtype ? `\`${g.subtype}\`` : "_not declared_")} |`);
  // Four goods comment their tier out, so the honest answer there is that it is not declared.
  rows.push(`| Tier | ${g.tier == null ? "_not declared — the mod comments its tier line out_" : `**${g.tier}**`} |`);
  rows.push(`| Trade value | ${g.tradeValue == null ? "_not declared_" : `**${g.tradeValue}**`} |`);
  rows.push(`| Groups | ${g.tags.length ? g.tags.map((t) => `[${t.replace(/_/g, " ")}](../trade-goods.md#${anchor(t.replace(/_/g, " "))})`).join(", ") : "_none declared_"} |`);
  if (g.depletable != null) rows.push(`| Depletable | ${g.depletable ? "yes" : "no"}${g.baseTurns != null ? `, exhausted after ${g.baseTurns} turns` : ""}${g.popImpact != null ? `, ${g.popImpact.toLocaleString("en-US")} population per unit` : ""} |`);
  if (g.mineTooltip) rows.push(`| When mined | ${g.mineTooltip} |`);

  // ── what it does ──
  const bullets = [];
  const levelList = (arr) => uniq(arr.map(([c, l]) => levelLink(c, l))).join(", ");
  if (f.levels.length) bullets.push(`**Lets you build** — ${f.levels.length} building ${f.levels.length === 1 ? "level" : "levels"}: ${levelList(f.levels)}`);
  if (f.blockedLevels.length) bullets.push(`**Blocks** — ${f.blockedLevels.length} building ${f.blockedLevels.length === 1 ? "level" : "levels"}: ${levelList(f.blockedLevels)}`);
  const effWords = (m) => uniq([...m.values()].map((e) => `${effectRange(e)} (${levelName(e.level)})`));
  if (f.effects.size) bullets.push(`**Numeric effects where it is present** — ${effWords(f.effects).join("; ")}`);
  if (f.blockedEffects.size) bullets.push(`**Numeric effects it withholds** — these are granted only where it is absent: ${effWords(f.blockedEffects).join("; ")}`);
  if (f.blockedUnits.size) bullets.push(`**Withholds ${f.blockedUnits.size}** ${f.blockedUnits.size === 1 ? "unit" : "units"} that are gated on the region *not* having it`);

  let doesBody;
  if (bullets.length) doesBody = bullets.map((b) => `- ${b}`).join("\n");
  else {
    const other = otherConsumerHits(g.tok);
    g.otherHits = other;
    const elsewhere = other.clause.length
      ? ` It is required by name in ${other.clause.join(", ")}, so look there.`
      : other.plain.length
        ? ` The name is mentioned in ${other.plain.join(", ")}, but never as a requirement.`
        : ` Nothing else that could read a resource — the campaign script, the mercenary pools, the rebel-faction blocks, the spawn scripts — names it either.`;
    // The slaves resource is the one case where "no mod rule" does not mean "no effect": its
    // subtype is engine behaviour, and the fields it declares are what govern it.
    const engine = g.subtype === "slaves"
      ? " Its effect is the engine's, not the mod's: the game creates this resource when a settlement is enslaved, and the depletable, base-turns and population fields declared above are what govern it."
      : "";
    doesBody = NOTHING + elsewhere + engine;
  }

  // ── units, which are the long part where there are any ──
  let unitsBody = "";
  if (f.units.size) {
    const rowsU = [...f.units.values()]
      .sort((a, b) => unitName(a.type).localeCompare(unitName(b.type)))
      .map((x) => `| ${unitLink(x.type)} | ${uniq([...x.levels].map((s) => { const [c, l] = s.split("|"); return levelLink(c, l); })).join(", ")} |`);
    const table = `| Unit | Raised at |\n|---|---|\n${rowsU.join("\n")}`;
    unitsBody = `\n\n## What it lets you raise\n\n**${f.units.size}** ${f.units.size === 1 ? "unit is" : "units are"} gated on a region having ${g.name}.\n\n`
      + (rowsU.length > 12 ? `<details>
<summary>${f.units.size} units</summary>\n\n${table}\n\n</details>` : table);
  }

  // ── where it is found ──
  let whereBody;
  if (!g.markers) {
    whereBody = `**Not placed anywhere on the map.** The campaign file puts no marker for it anywhere, so no region has it as the campaign ships.`;
  } else {
    const regionRows = [...g.byRegion.entries()]
      .sort((a, b) => b[1].quantity - a[1].quantity || a[0].localeCompare(b[0]))
      .map(([r, v]) => {
        const own = OWNER_OF.get(r);
        return `| ${regionLink(r)} | ${v.quantity} | ${own ? facRef(own) : "_independent_"} |`;
      });
    const byFaction = new Map();
    for (const r of g.byRegion.keys()) {
      const own = OWNER_OF.get(r) || null;
      byFaction.set(own, (byFaction.get(own) || 0) + 1);
    }
    const facRows = [...byFaction.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .map(([fac, n]) => `| ${fac ? facRef(fac) : "_independent_"} | ${n} |`);
    const regionCount = g.regionsAgree
      ? `**${nRegions.toLocaleString("en-US")}** ${nRegions === 1 ? "region" : "regions"}`
      : "_a number of regions this generator declines to state — the two ways of deriving it disagree_";
    // Where a good is on EVERY region, its per-region amount is a baseline rather than a
    // feature of the region, and gen-ris-region-pages.js hides it below that baseline for
    // exactly that reason. Saying so here is what stops a reader finding Slaves listed on this
    // page for a region whose own page does not mention it. Both numbers are counted, not
    // assumed, and the sentence only appears where the good really is everywhere.
    const totalRegions = regionPages.size || nRegions;
    const above = [...g.byRegion.values()].filter((v) => v.quantity > 1).length;
    const everywhere = nRegions >= totalRegions && totalRegions > 0
      ? `\n\nIt is on **every region on the map**, so its presence says nothing about a region — only a surplus does. `
        + `${above === 0 ? "No region has more than one" : `${above.toLocaleString("en-US")} ${above === 1 ? "region has" : "regions have"} more than one`}, and a region page lists it only where there is a surplus.`
      : "";
    whereBody = `**${g.markers.toLocaleString("en-US")}** ${g.markers === 1 ? "marker" : "markers"} on the map, `
      + `${g.quantity.toLocaleString("en-US")} in total quantity, across ${regionCount}.${everywhere}\n\n`
      + `<details>
<summary>Who holds those regions at the campaign start (${byFaction.size} ${byFaction.size === 1 ? "faction" : "factions"})</summary>\n\n`
      + `| Faction | Regions |\n|---|---:|\n${facRows.join("\n")}\n\n</details>\n\n`
      + `<details>
<summary>Every region that has it (${regionRows.length})</summary>\n\n`
      + `| Region | Amount | Held at the campaign start by |\n|---|---:|---|\n${regionRows.join("\n")}\n\n</details>`;
  }

  const lede = [
    // 28, not 48. The published icon is 120px and the source TGA 360, so nothing here is
    // literally upscaled — but the art is a small sprite with soft edges, and blown up to 48 at
    // the head of a page it reads as a low-resolution picture rather than as an icon. Kept just
    // above the 24 used inline, so a good's own page still leads with its mark.
    iconImg(g.tok, "../", 28),
    g.tooltipAdds ? `**In game:** ${g.tooltip}` : null,
  ].filter(Boolean).join("\n\n");

  const body = `# ${g.name}

[← all trade goods](../trade-goods.md) · [all regions](../regions.md) · [wiki index](../README.md)

${lede}

## What it is

| | |
|---|---|
${rows.join("\n")}

## What it does

${provenance(`The mod calls this good \`${g.tok}\` internally; that is the word the conditions on this page are written against.`)}

${doesBody}${unitsBody}

## Where it is found

${whereBody}
`;
  fs.writeFileSync(path.join(OUT, "goods", `${g.tok}.md`), body, "utf8");
}

for (const g of GOODS) goodPage(g);

// ── the index ────────────────────────────────────────────────────────────────
// One row per good, one line per row, numbers in their own right-aligned columns, so the
// table can be sorted or pasted into a spreadsheet without unpicking anything.
const numOrDash = (v) => (v == null ? "—" : String(v));
const indexRows = [...GOODS]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((g) => {
    const f = g.facts;
    const effects = f.effects.size + f.blockedEffects.size;
    const builds = f.levels.length + f.blockedLevels.length;
    // The subtype token said nothing: `none` on 40 of the 46 rows. What a reader wants from
    // this column is the one distinction it draws — whether the good comes out of a mine.
    const kind = g.subtype === "mineable" ? "mined" : g.subtype === "slaves" ? "slaves" : "traded";
    return `| ${iconImg(g.tok, "", 24)} | [${g.name}](goods/${g.tok}.md) | ${kind} | ${numOrDash(g.tier)} | ${numOrDash(g.tradeValue)} | ${g.regionsAgree ? g.byRegion.size.toLocaleString("en-US") : "_n/d_"} | ${g.quantity.toLocaleString("en-US")} | ${builds || "—"} | ${effects || "—"} | ${f.units.size || "—"} |`;
  });

// The tag groups descr_sm_resources declares. Kept even though nothing conditions on them —
// the file declares them, a reader will see them named on a good's page, and the useful thing
// to say about a classification is what is in it and that it gates nothing.
const FAMILIES = new Map();
for (const g of GOODS) for (const t of g.tags) {
  if (!FAMILIES.has(t)) FAMILIES.set(t, []);
  FAMILIES.get(t).push(g);
}
const familySections = [...FAMILIES.entries()]
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  .map(([t, list]) => `### ${t.replace(/_/g, " ")}\n\n${list.map((g) => `[${g.name}](goods/${g.tok}.md)`).join(" · ")}`)
  .join("\n\n");
const untagged = GOODS.filter((g) => !g.tags.length);
// Checked rather than asserted: is a GROUP ever the thing a condition names? A plain token
// search over export_descr_buildings.txt, which can only over-report — so a zero here really
// does mean the groups gate nothing, and if a future release starts using them the sentence
// below changes with the file instead of going quietly stale.
const groupsUsedInEdb = [...FAMILIES.keys()].filter((t) => new RegExp(`\\b${t}\\b`, "i").test(EDB_TXT));

const placedGoods = GOODS.filter((g) => g.markers).length;
const noEffect = GOODS.filter((g) => {
  const f = g.facts;
  return !(f.levels.length || f.blockedLevels.length || f.effects.size || f.blockedEffects.size
    || f.units.size || f.blockedUnits.size);
});

const regionsWithAnything = new Set([].concat(...GOODS.map((g) => [...g.byRegion.keys()]))).size;
const noTier = GOODS.filter((g) => g.tier == null);
// A marker is placed at most once per region, with one exception in the whole file. Worth
// stating rather than showing two near-identical columns: the number that actually varies is
// the QUANTITY on the marker, which is what a region page prints as the amount.
const dupRegions = GOODS.filter((g) => g.markers !== g.byRegion.size);

const indexBody = `# Trade goods

[← all regions](regions.md) · [region tag reference](tags.md) · [wiki index](README.md)

A trade good is a resource placed on the campaign map at a fixed spot. Whoever holds the
region around it has it, and it does three things: it is worth trade income, it may let the
settlement build something, and it may let the region raise troops nobody else can.

RIS declares **${GOODS.length}** of them. ${placedGoods} are placed on the map — ${PLACED.stats.lines.toLocaleString("en-US")} markers
in total, and between them they reach **every one of the ${regionsWithAnything.toLocaleString("en-US")} regions**, because
one of them is on all of them.${GOODS.length - placedGoods ? ` The other ${GOODS.length - placedGoods} are declared but placed nowhere at all.` : ""}

${noEffect.length} ${noEffect.length === 1 ? "has" : "have"} nothing in the mod conditioned on
${noEffect.length === 1 ? "it" : "them"}: ${noEffect.map((g) => `[${g.name}](goods/${g.tok}.md)`).join(", ")}. That is a finding, not a gap —
each of those pages says which other files were searched before the claim was made.

${PROVENANCE}

Reading the table: **tier** and **trade value** are the good's own declared numbers — tier its
rank, trade value what a unit of it is worth in trade. ${noTier.length} goods have their tier line
commented out in the mod file and show **—**, which means not declared, not zero. **Regions**
is how many regions have it; **quantity** is those markers' amounts added up, which is the
number that varies, since a good is placed at most once per region${dupRegions.length ? ` (the single exception in the whole file is ${dupRegions.map((g) => g.name).join(", ")}, which has one region carrying two markers)` : ""}.

| | Good | Kind | Tier | Trade value | Regions | Quantity | Builds | Effects | Units |
|:-:|---|---|---:|---:|---:|---:|---:|---:|---:|
${indexRows.join("\n")}

## Groups

The mod puts some goods into **${FAMILIES.size}** named groups.
${groupsUsedInEdb.length === 0
    ? "None of those ${n} names is used as a condition anywhere — every condition in the mod names a single good — so a group is a classification the mod declares rather than a mechanic."
      .replace("${n}", FAMILIES.size)
    : `**${groupsUsedInEdb.length}** of them are used as a condition somewhere (${groupsUsedInEdb.join(", ")}), so those are worth following up; the rest are classification only.`}
**${untagged.length}** of the ${GOODS.length} goods are in no group at all.${(() => {
    const singles = [...FAMILIES.entries()].filter(([, l]) => l.length === 1);
    return singles.length ? ` ${singles.length} of the groups contain exactly one good (${singles.map(([t]) => t.replace(/_/g, " ")).join(", ")}), which is a group that groups nothing.` : "";
  })()}

${familySections}

<details>
<summary>How each figure on this page was counted, and checked</summary>

- **Goods** — the non-hidden blocks in descr_sm_resources.txt, found by brace depth with
  comments stripped. The block count was checked a second way against the flat pattern the
  other generators use over the same file; both find ${BLOCKS.length.toLocaleString("en-US")} blocks,
  ${hiddenCount.toLocaleString("en-US")} of them hidden.
- **Markers and regions** — the \`resource\` lines in descr_strat.txt, each mapped to a region
  through map_regions.tga. Every good's region set was then derived a second, independent way
  from the region each line names in its own trailing comment. The two agree for all
  ${goodsAgreeing} placed goods; a good where they disagreed would be shown as **n/d** here.
- **Builds, effects and units** — counted from export_descr_buildings.txt, alias indirection
  expanded, negated clauses included. The ${FAMILIES.size} group names were searched for in the
  same file before the Groups section claimed they gate nothing; ${groupsUsedInEdb.length} appear in it.

</details>
`;
fs.writeFileSync(path.join(OUT, "trade-goods.md"), indexBody, "utf8");

// ── report ───────────────────────────────────────────────────────────────────
const say = (s) => console.log(s);
say(`trade goods -> ${path.join(OUT, "goods")} (+ trade-goods.md)`);
say(`  descr_sm_resources.txt: ${BLOCKS.length.toLocaleString("en-US")} blocks by brace depth, ${BLOCKS_VIA_REGEX.toLocaleString("en-US")} by the flat pattern the other generators use  <- these must agree`);
say(`    of those, ${hiddenCount.toLocaleString("en-US")} hidden and ${GOODS.length} trade goods`);
{
  const bySub = {};
  for (const g of GOODS) bySub[g.subtype || "(none declared)"] = (bySub[g.subtype || "(none declared)"] || 0) + 1;
  say(`    subtypes: ${Object.entries(bySub).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}
say(`  tier declared for ${GOODS.filter((g) => g.tier != null).length}/${GOODS.length}; the rest comment the line out and are published as not declared (${GOODS.filter((g) => g.tier == null).map((g) => g.tok).join(", ") || "none"})`);
say(`  trade value declared for ${GOODS.filter((g) => g.tradeValue != null).length}/${GOODS.length}`);
say(`  display names resolved: ${nameHits}/${GOODS.length} via the key the good declares for itself${nameMisses.length ? ` (missing: ${nameMisses.join(", ")})` : ""}`);
say(`  tooltips resolved:      ${tipHits}/${GOODS.length}${tipMisses.length ? ` (missing: ${tipMisses.join(", ")})` : ""}`);
say(`    of which ${tipEchoes} merely repeat the display name and are not printed; ${tipHits - tipEchoes} say something the name does not`);
say(`  mining tooltips:        ${mineTipHits}/${mineTipDeclared} declared and resolved`);

say(`\nplacements (descr_strat.txt):`);
say(`  lines matched by the four-field pattern: ${PLACED.stats.lines.toLocaleString("en-US")}`);
say(`  lines beginning "resource " at all:      ${PLACED.stats.altLines.toLocaleString("en-US")}  <- a gap means the pattern is dropping some`);
say(`  markers no region could be found for:    ${PLACED.stats.unresolved.toLocaleString("en-US")}`);
say(`  markers with no trailing region comment: ${PLACED.stats.noNote.toLocaleString("en-US")}; comment naming nothing known: ${PLACED.stats.noteUnknown.toLocaleString("en-US")}`);
say(`  per-good region sets, map lookup vs the line's own comment: ${goodsAgreeing}/${GOODS.filter((g) => g.markers).length} placed goods agree exactly`);
if (goodsDisagreeing.length) for (const d of goodsDisagreeing) say(`    DISAGREE, published as not determined — ${d}`);
say(`  goods declared but placed nowhere: ${stats.unplaced} (${GOODS.filter((g) => !g.markers).map((g) => g.tok).join(", ") || "none"})`);

say(`\nwhat they do (export_descr_buildings.txt):`);
say(`  goods named by at least one clause: ${USAGE.size} of ${GOODS.length}`);
say(`  goods with an effect established:   ${stats.withEffect}; with none: ${stats.withoutEffect} (${noEffect.map((g) => g.tok).join(", ") || "none"})`);
say(`  before claiming a good does nothing, ${OTHER_CONSUMERS.length} other files were searched (campaign script, mercenary pools, rebel factions, spawn scripts):`);
say(`    of those ${stats.withoutEffect}, ${noEffect.filter((g) => g.otherHits && g.otherHits.clause.length).length} carry a \`resource <good>\` clause there and ${noEffect.filter((g) => g.otherHits && !g.otherHits.clause.length && g.otherHits.plain.length).length} are merely named${noEffect.filter((g) => g.otherHits && g.otherHits.plain.length).map((g) => ` — ${g.tok} in ${g.otherHits.plain.join(", ")}`).join("")}`);
say(`  goods that gate at least one unit:  ${stats.withUnits}`);
say(`  display names: ${levelNameMisses} building levels with no text entry, ${unitNameMisses} units with no name`);
if (unknownEffects.size) say(`  effect kinds with no wording (shown as the raw key): ${[...unknownEffects].join(", ")}`);

say(`\nownership at the campaign start: ${OWNER_OF.size.toLocaleString("en-US")} regions have a settlement in descr_strat (faction -> settlements, inverted)`);
say(`icons: ${iconFiles.size} present in ${path.join(OUT, "resource-icons")}, written by gen-ris-region-pages.js`);
say(`  goods with no icon file: ${stats.iconMissing.length}${stats.iconMissing.length ? ` (${stats.iconMissing.join(", ")}) <- run gen-ris-region-pages.js first` : ""}`);
say(`  pages written: ${GOODS.length} under goods/, plus trade-goods.md`);
