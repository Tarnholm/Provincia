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
const NO_PAGE = new Set(["slave", "roman_senate", "dummies"]);
const hasPage = (f) => !NO_PAGE.has(String(f).toLowerCase());
const facName = (f) => display[String(f).toLowerCase()] || String(f).replace(/_/g, " ");

const list = ONLY.length ? regions.filter((r) => ONLY.includes(r.region)) : regions;
fs.mkdirSync(path.join(OUT, "regions"), { recursive: true });

let withOwner = 0, withBuildings = 0, withTrade = 0;
const index = [];

for (const r of list) {
  const held = byRegion[r.region] || null;
  if (held) withOwner++;
  if (held && (held.buildings || []).length) withBuildings++;
  const g = classify(r.tags, res);
  if (g.trade.length) withTrade++;

  const sect = (label, arr, note) => arr.length
    ? `**${label}:** ${arr.map((t) => `\`${t}\``).join(", ")}${note ? `\n\n> ${note}` : ""}\n\n` : "";

  const body = `# ${r.region}

[← all regions](../regions.md) · [wiki index](../README.md)

**Settlement:** ${r.settlement}
${held ? `**Held at campaign start by:** ${hasPage(held.faction) ? `[${facName(held.faction)}](../factions/${held.faction}.md)` : facName(held.faction)}${held.capital ? " — **their capital**" : ""}
**Size:** ${String(held.level || "").replace(/_/g, " ")} · **Population:** ${held.pop != null ? held.pop.toLocaleString("en-US") : "unknown"}` : `**Held at campaign start by:** nobody — this region begins independent.
**If it revolts, the rebels are:** ${r.rebels}`}

## Resources and character

${sect("Trade resources", g.trade)}${sect("Farm level", g.farm, FARM_NOTE)}${sect("Terrain", g.terrain)}${sect("Port", g.port)}${sect("Religion", g.religion)}${sect("Recruitment zones", g.recruitment)}${sect("Cultural homeland", g.culture)}${sect("Geography and gating", g.geography)}${sect("Other tags", g.other)}${r.tags.length ? "" : "_This region carries no tags._\n\n"}## What is already built

${held && (held.buildings || []).length
  ? `| | Building chain | Level |\n|:-:|---|---|\n${held.buildings.map((b) => `| ${(() => { const ic = iconFor(held.faction, b.level); return ic ? `<img src="../${ic}" alt="" width="32">` : ""; })()} | ${b.chain.replace(/_/g, " ")} | ${bName(b.level) ? `**${bName(b.level)}** <br>\`${b.level}\`` : `\`${b.level}\``} |`).join("\n")}`
  : held ? "_Nothing is built here at the campaign start._" : "_Independent regions have no starting buildings recorded in the campaign file._"}
`;

  fs.writeFileSync(path.join(OUT, "regions", `${r.region}.md`), body, "utf8");
  index.push({ region: r.region, settlement: r.settlement, owner: held ? facName(held.faction) : null, ownerTok: held ? held.faction : null, trade: g.trade.length, builds: held ? (held.buildings || []).length : 0 });
}

index.sort((a, b) => a.region.localeCompare(b.region));
const idx = `# All regions

[← wiki index](README.md)

${index.length} regions. ${withOwner} are held by a faction at the campaign start; the rest
begin independent.

| Region | Settlement | Held by | Trade resources | Buildings |
|---|---|---|---:|---:|
${index.map((e) => `| [${e.region}](regions/${e.region}.md) | ${e.settlement} | ${e.owner ? (hasPage(e.ownerTok) ? `[${e.owner}](factions/${e.ownerTok}.md)` : e.owner) : "_independent_"} | ${e.trade} | ${e.builds} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "regions.md"), idx, "utf8");

console.log(`${list.length} region pages written`);
console.log(`  held by a faction at start: ${withOwner}`);
console.log(`  with something built:       ${withBuildings}`);
console.log(`  with a trade resource:      ${withTrade}`);
console.log(`  resource vocabulary read:   ${res.tradeable.size} tradeable, ${res.hidden.size} hidden`);
