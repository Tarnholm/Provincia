#!/usr/bin/env node
/**
 * One wiki page per RIS region.
 *
 *   node scripts/gen-ris-region-pages.js [--ris <dir>] [--out <dir>] [--only <region,…>]
 *
 * Everything comes from descr_regions and descr_strat:
 *   - the settlement, its owner at campaign start, size and population
 *   - trade resources and the terrain/religion tags the region carries
 *   - what is already built there
 *
 * TAGS ARE CLASSIFIED, NOT DUMPED. A region's tag line mixes several unrelated things —
 * `rome, italy, n_italy, homeland_roman, aor_camillan, rel_italic_4, Farm11, river_valley,
 * mediterranean, base_port_level_2, rivertrade, irrigation_river` — and a player wants the
 * trade goods separated from the recruitment zones and the religion. Anything unrecognised
 * is still listed under "other", because silently dropping a tag would hide real content.
 */
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const valOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const RIS = valOf("--ris", "C:/RIS/RIS/data");
// For the region-colour parser and the TGA reader, both already used elsewhere in Provincia.
const dg = require(path.join(__dirname, "..", "src", "descrStratGeneral.js"));
const OUT = valOf("--out", "C:/RIS/RIS/wiki");
const ONLY = (valOf("--only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const gv = require(path.join(__dirname, "..", "src", "growthEval.js"));
const rd = (...f) => { try { return fs.readFileSync(path.join(RIS, ...f), "latin1"); } catch { return null; } };

// ── descr_regions ────────────────────────────────────────────────────────────
// Block shape: RegionName / settlement / owner / rebel-name / "R G B" / tags / N / N
function loadRegions() {
  const lines = (rd("world", "maps", "base", "descr_regions.txt") || "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(lines[i])) continue;
    const body = [];
    for (let k = i + 1; k < Math.min(i + 9, lines.length); k++) {
      const t = lines[k].trim();
      if (!t || t.startsWith(";")) continue;
      if (/^[A-Za-z][A-Za-z0-9_'\- ]*$/.test(lines[k])) break;   // next block header
      body.push(t);
    }
    // Needs at least settlement, owner, rebel, colour to be a real block.
    const rgbAt = body.findIndex((l) => /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(l));
    if (rgbAt < 2) continue;
    const tagLine = body[rgbAt + 1] || "";
    out.push({
      region: lines[i].trim(),
      settlement: body[0],
      owner: body[1],
      rebels: body[2],
      colour: body[rgbAt],
      tags: tagLine.split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  return out;
}

// ── tag classification ───────────────────────────────────────────────────────
// Derived from what descr_sm_resources actually declares, so the trade-good list is the
// mod's own vocabulary rather than a guess. Everything else is sorted by naming
// convention, and whatever is left over is still shown.
// Only NON-HIDDEN resources are trade goods. RIS declares a great deal of geography as
// hidden resources — `rome`, `italy`, `n_italy` are all entries in this file — so treating
// every declared name as a trade good listed Rome's province tags as merchandise.
// The `subtype` field is what separates them.
function loadResourceNames() {
  const txt = rd("descr_sm_resources.txt") || "";
  const tradeable = new Set();
  const hidden = new Set();
  // Blocks look like:  "name": { … "subtype": "hidden" … }
  const re = /"([A-Za-z0-9_\-]+)"\s*:\s*\{([\s\S]*?)\n\s*\}/g;
  for (const m of txt.matchAll(re)) {
    const n = m[1].toLowerCase();
    if (n === "resources") continue;
    const st = /"subtype"\s*:\s*"([a-z_]+)"/.exec(m[2]);
    if (st && st[1] === "hidden") hidden.add(n); else tradeable.add(n);
  }
  return { tradeable, hidden };
}

function classify(tags, res) {
  const g = { trade: [], farm: [], terrain: [], religion: [], recruitment: [], port: [], culture: [], geography: [], other: [] };
  for (const t of tags) {
    const l = t.toLowerCase();
    if (/^farm\d+$/i.test(t)) g.farm.push(t);
    else if (/^rel_/.test(l)) g.religion.push(t);
    else if (/^aor_/.test(l)) g.recruitment.push(t);
    else if (/^homeland_/.test(l)) g.culture.push(t);
    else if (/port|harbour|harbor/.test(l)) g.port.push(t);
    else if (/^(river_valley|mediterranean|desert|steppe|forest|mountain|swamp|coastal|arid|temperate|tropical)/.test(l)) g.terrain.push(t);
    else if (res.tradeable.has(l) || /^(rivertrade|seatrade)$/.test(l)) g.trade.push(t);
    // Declared but hidden: RIS uses these for geography and gating, not commerce.
    else if (res.hidden.has(l)) g.geography.push(t);
    else g.other.push(t);
  }
  return g;
}


// ── display names ────────────────────────────────────────────────────────────
// text/export_buildings.txt (UTF-16LE) maps a building level token to the name the game
// shows: proconsuls_palace -> "Pro-Consul's Palace", gov4 -> "Homeland", mic_2 ->
// "Basic Armoury". Printing raw tokens made every page read like a data dump.
//
// NOTE units are NOT resolvable this way. Their text keys are not the EDU `type` string
// (`aor arab levy spearmen` has no entry, though `ballistas` does) - the mapping lives in
// each unit's `dictionary` field in export_descr_unit.txt, which is not wired up yet. Same
// for most region tags: resources.txt keys look like SMT_RESOURCE_GOLD and cover only the
// 104 standard goods, so custom tokens such as `rivertrade` have no display name.
function loadDisplayNames(file) {
  const map = {};
  try {
    const t = fs.readFileSync(path.join(RIS, "text", file), "utf16le");
    for (const m of t.matchAll(/\{([^}]+)\}(.*)/g)) map[m[1].trim().toLowerCase()] = m[2].trim();
  } catch { /* fall back to the raw token */ }
  return map;
}
const BUILDING_NAMES = loadDisplayNames("export_buildings.txt");
/** Display name for a building level, or the token itself when there is no entry. */
const bName = (tok) => BUILDING_NAMES[String(tok).toLowerCase()] || null;

// Building icons, produced by gen-ris-building-icons.js which resolves culture fallbacks
// and level aliases from descr_ui_buildings.txt. Keyed "<culture>/<level>". Absent map =
// icons have not been generated yet, and the pages simply omit them.
let ICONS = {};
try { ICONS = JSON.parse(fs.readFileSync(path.join(OUT, "icons", "index.json"), "utf8")); } catch { /* no icons yet */ }
// Built from char codes so no patch script can turn the escapes into real control
// characters inside the literal - which is exactly what broke this file.
const SPLIT_EOL = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10));
const FACTION_CULTURE = (() => {
  const txt = rd("descr_sm_factions.txt") || "";
  const out = {};
  let cur = null;
  for (const raw of txt.split(SPLIT_EOL)) {
    const line = raw.replace(/;.*$/, "");
    let m = /^\s*"([a-z0-9_]+)"\s*:\s*$/.exec(line);
    if (m && m[1] !== "factions") { cur = m[1].toLowerCase(); continue; }
    m = /"culture"\s*:\s*"([a-z_]+)"/.exec(line);
    if (m && cur) { out[cur] = m[1].toLowerCase(); cur = null; }
  }
  return out;
})();
const iconFor = (faction, level) => {
  const cul = FACTION_CULTURE[String(faction).toLowerCase()];
  if (!cul) return null;
  return ICONS[`${cul}/${String(level).toLowerCase()}`] || null;
};

// ── trade goods placed on the map ────────────────────────────────────────────
// The "Trade resources" field used to come from each region's descr_regions tags, which in
// RIS means it only ever said `rivertrade` — all 422 regions that had anything. The real
// trade goods are 5,547 `resource <type>, <x>, <y>` placements in descr_strat, positioned on
// the map rather than assigned to a region, so they have to be looked up through
// map_regions.tga.
//
// COORDINATE CONVENTION, measured rather than assumed. descr_strat y indexes the TGA's
// storage row directly: RTW counts y from the bottom of the map and the TGA is stored
// bottom-up, so the two cancel. Verified against the 749 settlements whose city name gives a
// known region — regressing their coordinates against each region's pixel centroid gives
// slope 1.00 and r2 0.998, and looking each one up agrees for 747 of 749 (100%).
//
// The exact pixel matches only 1% of the time because a settlement's own tile is painted its
// own colour, so a small neighbourhood is sampled and the commonest region colour wins. The
// same is true of a resource icon's tile, which is why this is not a single-pixel read.
function loadMapResources() {
  const out = new Map();     // region -> Map(type -> count)
  let placed = 0, resolved = 0, checked = 0, agreed = 0;
  const stratPath = path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt");
  let strat;
  try { strat = fs.readFileSync(stratPath, "latin1"); } catch { return { out, placed, resolved, checked, agreed }; }

  let rgbToRegion, regionToCity = {};
  let t;
  try {
    const dr = fs.readFileSync(path.join(RIS, "world", "maps", "base", "descr_regions.txt"), "latin1");
    const parsed = dg.parseDescrRegions(dr);
    rgbToRegion = parsed.rgbToRegion;
    regionToCity = parsed.regionToCity;
    t = dg.tgaToRaw(fs.readFileSync(path.join(RIS, "world", "maps", "base", "map_regions.tga")));
  } catch { return { out, placed, resolved, checked, agreed }; }

  const cityOf = (region) => regionToCity[region] || null;
  const regionAt = (x, y) => {
    if (x < 0 || y < 0 || x >= t.W || y >= t.H) return null;
    const i = (y * t.W + x) * 3;
    return rgbToRegion[`${t.raw[i + 2]},${t.raw[i + 1]},${t.raw[i]}`] || null;
  };
  const regionNear = (x, y) => {
    const votes = new Map();
    for (let r = 0; r <= 3; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring only
          const reg = regionAt(x + dx, y + dy);
          if (reg) votes.set(reg, (votes.get(reg) || 0) + 1);
        }
      }
      if (votes.size) break;   // nearest ring that finds anything wins
    }
    let best = null, n = 0;
    for (const [reg, c] of votes) if (c > n) { best = reg; n = c; }
    return best;
  };

  // `resource <type>, <quantity>, <x>, <y>   ; <settlement>`  — FOUR numeric-ish fields, not
  // two. Reading the quantity as x put 1,166 placements in one Saharan region and left the x
  // range at 1-5, which is what gave the error away. The trailing comment names the
  // settlement, and agreement with it is the check reported below.
  for (const m of strat.matchAll(/^resource\s+([a-z_]+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:;\s*(.*))?$/gim)) {
    placed++;
    const reg = regionNear(+m[3], +m[4]);
    const note = (m[5] || "").trim();
    // The trailing comment names the REGION, not its settlement — `; Roma` on a resource
    // inside the region Roma, whose city is Rome. Comparing it against the city name scored
    // 1% and looked like a broken mapping when the mapping was fine.
    if (note) {
      checked++;
      if (reg && (reg.toLowerCase() === note.toLowerCase() ||
                  (cityOf(reg) || "").toLowerCase() === note.toLowerCase())) agreed++;
    }
    if (!reg) continue;
    resolved++;
    let e = out.get(reg);
    if (!e) { e = new Map(); out.set(reg, e); }
    const type = m[1].toLowerCase();
    e.set(type, (e.get(type) || 0) + 1);
  }
  return { out, placed, resolved, checked, agreed };
}
const MAP_RESOURCES = loadMapResources();

// ── readable tag names ───────────────────────────────────────────────────────
// Every region tag was printed as a bare token: `rivertrade`, `rel_dorian_4`,
// `base_port_level_2`, `aor_akarnanian`. Trade goods have real names in text/resources.txt,
// keyed SMT_RESOURCE_<GOOD>, so those are looked up. The rest have no text entry anywhere in
// the mod, so they are humanised from the token itself — prefix stripped, underscores out —
// with the raw token still shown, because it is what a modder searches the files for.
const RESOURCE_NAMES = loadDisplayNames("resources.txt");
const resName = (tok) => RESOURCE_NAMES[`smt_resource_${String(tok).toLowerCase()}`] || null;

const TAG_PREFIXES = [
  [/^aor_/, ""], [/^homeland_/, ""], [/^rel_/, ""], [/^base_port_level_/, "port level "],
  [/^Farm/i, "farm level "], [/^gov\d*/, ""],
];
function humanise(tok) {
  let s = String(tok);
  for (const [re, repl] of TAG_PREFIXES) if (re.test(s)) { s = s.replace(re, repl); break; }
  s = s.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return String(tok);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// "Gold (`gold`)" — the readable name first, the token kept for anyone reading the files.
function tagLabel(tok) {
  const nice = resName(tok) || humanise(tok);
  const raw = String(tok);
  return nice.toLowerCase() === raw.toLowerCase() ? `\`${raw}\`` : `${nice} \`${raw}\``;
}

const FARM_NOTE = "Farm level sets the region's agricultural base. NOTE Provincia's own " +
  "measurements found RIS cancels farm fertility almost exactly, so a higher number here " +
  "does not translate into faster growth the way it does in vanilla.";

// ── build ────────────────────────────────────────────────────────────────────
const regions = loadRegions();
if (!regions.length) { console.error("no regions parsed — check descr_regions.txt"); process.exit(2); }
const res = loadResourceNames();

// settlement -> {faction, level, pop, buildings}
const strat = gv.parseStrat(path.join(RIS, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt")) || {};
const byRegion = {};
for (const [fac, v] of Object.entries(strat)) {
  for (const s of (v.settlements || [])) byRegion[s.region] = { faction: fac, ...s };
}

// faction token -> display name, from the localised campaign descriptions
const display = {};
try {
  const t = fs.readFileSync(path.join(RIS, "text", "campaign_descriptions.txt"), "utf16le");
  for (const m of t.matchAll(/\{IMPERIAL_CAMPAIGN_([A-Z0-9_]+)_TITLE\}([^\r\n]*)/g)) display[m[1].toLowerCase()] = m[2].trim();
} catch { /* fall back to tokens */ }
// The faction generator skips the three non-player factions, so they have no page and
// must not be linked. ~1,000 regions are held by `slave` at the campaign start, which is
// where the 1,006 broken links came from.
// Must match the exclusion set in gen-ris-faction-pages.js: linking a faction with no page
// was 1,006 broken links once already.
const NO_PAGE = new Set([
  "slave", "roman_senate", "dummies",
  "roman_rebels_1", "roman_rebels_2", "hellenistic_rebels",
  "ptolemaic_rebels", "seleucid_rebels", "seleucid_rebels2",
]);
const hasPage = (f) => !NO_PAGE.has(String(f).toLowerCase());
const facName = (f) => display[String(f).toLowerCase()] || String(f).replace(/_/g, " ");

const list = ONLY.length ? regions.filter((r) => ONLY.includes(r.region)) : regions;
fs.mkdirSync(path.join(OUT, "regions"), { recursive: true });

let withMapGoods = 0, withOwner = 0, withBuildings = 0, withTrade = 0;
const index = [];

for (const r of list) {
  const held = byRegion[r.region] || null;
  if (held) withOwner++;
  if (held && (held.buildings || []).length) withBuildings++;
  const g = classify(r.tags, res);
  if (g.trade.length) withTrade++;

  // One row per attribute. These were nine consecutive "**Label:** value" lines, which every
  // markdown renderer folds into a single run-on paragraph — the labels only looked like
  // separate lines in the source file. A table also puts the values in a column you can scan
  // down when comparing regions.
  const rows = [];
  const addRow = (label, arr, note) => {
    if (!arr.length) return;
    rows.push(`| ${label} | ${arr.map(tagLabel).join(", ")} |`);
    if (note) rows.push(`| | _${note}_ |`);
  };

  // Trade goods actually placed inside this region's borders, commonest first.
  const goods = [...(MAP_RESOURCES.out.get(r.region) || new Map())]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const goodsLabel = goods.map(([type, n]) =>
    `${resName(type) || humanise(type)}${n > 1 ? ` ×${n}` : ""}`);
  if (goods.length) withMapGoods++;

  const glance = [
    `**Settlement:** ${r.settlement}`,
    held ? `**Size:** ${String(held.level || "").replace(/_/g, " ")}` : null,
    held && held.pop != null ? `**Population:** ${held.pop.toLocaleString("en-US")}` : null,
    goodsLabel.length ? `**Trade goods:** ${goodsLabel.join(", ")}` : null,
  ].filter(Boolean).join(" · ");

  if (goodsLabel.length) {
    rows.push(`| Trade goods on the map | ${goodsLabel.map((l, i) => `${l} \`${goods[i][0]}\``).join(", ")} |`);
  }
  addRow("Region resource tags", g.trade);
  addRow("Farm level", g.farm, FARM_NOTE);
  addRow("Terrain", g.terrain);
  addRow("Port", g.port);
  addRow("Religion", g.religion);
  addRow("Recruitment zones", g.recruitment);
  addRow("Cultural homeland", g.culture);
  addRow("Geography and gating", g.geography);
  addRow("Other tags", g.other);

  const body = `# ${r.region}

[← all regions](../regions.md) · [wiki index](../README.md)

${glance}

${held ? `Held at the campaign start by ${hasPage(held.faction) ? `[${facName(held.faction)}](../factions/${held.faction}.md)` : facName(held.faction)}${held.capital ? " — **their capital**" : ""}.` : `This region begins **independent**. If it revolts, the rebels are ${r.rebels}.`}

## Resources and character

${rows.length ? `| | |\n|---|---|\n${rows.join("\n")}` : "_This region carries no tags._"}

## What is already built

${held && (held.buildings || []).length
  ? `| | Building chain | Level |\n|:-:|---|---|\n${held.buildings.map((b) => `| ${(() => { const ic = iconFor(held.faction, b.level); return ic ? `<img src="../${ic}" alt="" width="32">` : ""; })()} | ${b.chain.replace(/_/g, " ")} | ${bName(b.level) ? `**${bName(b.level)}** <br>\`${b.level}\`` : `\`${b.level}\``} |`).join("\n")}`
  : held ? "_Nothing is built here at the campaign start._" : "_Independent regions have no starting buildings recorded in the campaign file._"}
`;

  fs.writeFileSync(path.join(OUT, "regions", `${r.region}.md`), body, "utf8");
  index.push({ region: r.region, settlement: r.settlement, owner: held ? facName(held.faction) : null, ownerTok: held ? held.faction : null, trade: goods.length, builds: held ? (held.buildings || []).length : 0 });
}

index.sort((a, b) => a.region.localeCompare(b.region));
const idx = `# All regions

[← wiki index](README.md)

${index.length} regions. ${withOwner} are held by a faction at the campaign start; the rest
begin independent.

| Region | Settlement | Held by | Trade goods | Buildings |
|---|---|---|---:|---:|
${index.map((e) => `| [${e.region}](regions/${e.region}.md) | ${e.settlement} | ${e.owner ? (hasPage(e.ownerTok) ? `[${e.owner}](factions/${e.ownerTok}.md)` : e.owner) : "_independent_"} | ${e.trade} | ${e.builds} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "regions.md"), idx, "utf8");

console.log(`${list.length} region pages written`);
console.log(`  held by a faction at start: ${withOwner}`);
console.log(`  with something built:       ${withBuildings}`);
console.log(`  map resource placements: ${MAP_RESOURCES.placed.toLocaleString("en-US")} placed, ${MAP_RESOURCES.resolved.toLocaleString("en-US")} mapped to a region`);
console.log(`  cross-check vs the file's own settlement comment: ${MAP_RESOURCES.agreed.toLocaleString("en-US")}/${MAP_RESOURCES.checked.toLocaleString("en-US")} agree (${MAP_RESOURCES.checked?Math.round(MAP_RESOURCES.agreed/MAP_RESOURCES.checked*100):0}%)`);
console.log(`  regions with trade goods:  ${withMapGoods.toLocaleString("en-US")}`);
console.log(`  with a trade resource:      ${withTrade}`);
console.log(`  resource vocabulary read:   ${res.tradeable.size} tradeable, ${res.hidden.size} hidden`);
