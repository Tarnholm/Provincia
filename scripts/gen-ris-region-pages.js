#!/usr/bin/env node
/**
 * One wiki page per RIS region.
 *
 *   node scripts/gen-ris-region-pages.js [--ris <dir>] [--out <dir>] [--only <region,…>]
 *
 * Everything comes from descr_regions and descr_strat:
 *   - the settlement, its owner at campaign start, size and population
 *   - trade resources and the terrain/religion tags the region carries
 *   - who lives there, as percentages, from descr_regions' own ethnicities field
 *   - what is already built there
 *
 * This generator also writes the trade-good icons it references, into wiki/resource-icons/,
 * so running it alone produces pages whose images all resolve. The building icons come from
 * gen-ris-building-icons.js instead, because those need a culture as well as a level.
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
// Block shape, all eight body lines indented under the region name (see App.js
// patchDescrRegions, which lists the same layout because it edits this file in place):
//   [0] settlement  [1] owning faction  [2] rebel name  [3] "R G B"
//   [4] tags        [5] farm level      [6] pop level   [7] ethnicities
// Indexed off the RGB line rather than off 0, because it is the only line whose shape is
// unmistakable, and a stray comment or blank line inside a block would otherwise shift
// everything after it.
function loadRegions() {
  const lines = (rd("world", "maps", "base", "descr_regions.txt") || "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^[A-Za-z][A-Za-z0-9_'\- ]*\s*$/.test(lines[i])) continue;
    // Window widened from 9 to 14: at 9 it stopped one line short on any block carrying a
    // comment, and the ethnicities line is the LAST of the eight, so it was the one lost.
    // Reading past the block is safe — the loop breaks on the next un-indented header.
    const body = [];
    for (let k = i + 1; k < Math.min(i + 14, lines.length); k++) {
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
      ethnicitiesRaw: body[rgbAt + 4] == null ? null : body[rgbAt + 4],
      ethnicities: parseEthnicities(body[rgbAt + 4]),
    });
  }
  return out;
}

/**
 * "dorian 70 italic 30" -> [{name:"dorian", pct:70}, …], the same pairwise walk Provincia's
 * own region panel uses (parseEthnicities in src/App.js). Returns [] when the line is not a
 * sequence of name/number pairs, so an unparseable field is reported rather than guessed at.
 *
 * WHY THIS FIELD AND NOT THE rel_ TAGS. The trailing digit in `rel_egyptian_4` is a 1-4
 * STRENGTH TIER, not a percentage — the pages used to print "Egyptian 4, Macedonian 1",
 * which reads like 4% and 1%. The percentages are here, in field 7, and they sum to exactly
 * 100 for all 1,311 regions.
 */
function parseEthnicities(str) {
  if (!str) return [];
  const parts = String(str).trim().split(/\s+/);
  if (parts.length < 2 || parts.length % 2 !== 0) return [];
  const out = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    const pct = parseInt(parts[i + 1], 10);
    if (isNaN(pct) || !/^[a-z_]+$/i.test(parts[i])) return [];
    out.push({ name: parts[i].toLowerCase(), pct });
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
// Each block also declares its own localised NAME KEY and its own ICON FILE, so neither has
// to be guessed from the token. That matters here: RIS reuses vanilla slots under new names,
// and the mapping is not the identity — token `horses` declares "name": "SMT_RESOURCE_FURS",
// token `salt` declares "SMT_RESOURCE_DOG", token `fish` declares "SMT_RESOURCE_PIG". Looking
// up `smt_resource_<token>` misses all three and falls through to humanising the token.
function loadResourceNames() {
  const txt = rd("descr_sm_resources.txt") || "";
  const tradeable = new Set();
  const hidden = new Set();
  const meta = {};   // token -> { subtype, nameKey, icon }  (non-hidden only)
  // Blocks look like:  "name": { … "subtype": "hidden" … }
  const re = /"([A-Za-z0-9_\-]+)"\s*:\s*\{([\s\S]*?)\n\s*\}/g;
  for (const m of txt.matchAll(re)) {
    const n = m[1].toLowerCase();
    if (n === "resources") continue;
    const st = /"subtype"\s*:\s*"([a-z_]+)"/.exec(m[2]);
    if (st && st[1] === "hidden") { hidden.add(n); continue; }
    tradeable.add(n);
    const nm = /"name"\s*:\s*"([A-Za-z0-9_]+)"/.exec(m[2]);
    const ic = /"icon"\s*:\s*"([^"]+)"/.exec(m[2]);
    meta[n] = {
      subtype: st ? st[1] : null,
      nameKey: nm ? nm[1].toLowerCase() : null,
      icon: ic ? ic[1] : null,
    };
  }
  return { tradeable, hidden, meta };
}
// Read here rather than in the build section below, because the display-name and icon
// lookups are both built from it.
const res = loadResourceNames();

// Tag categories, taken from Provincia's own region panel (src/RegionInfo.js,
// categoriseTag) so the wiki and the app say the same thing about the same token. Copying
// them corrected two real errors here: `mediterranean`, `arid`, `temperate` and `tropical`
// are CLIMATES and were being reported as terrain, and the irrigation tags were being filed
// under "geography and gating" rather than named as irrigation. `earthquake` and `rivertrade`
// are a hazard and a river-trade flag respectively, not merchandise.
// Kept in sync by regionTagCategories.test.js, which reads both files.
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
// AORs that gate a unit type or reform era rather than a place — Provincia keeps these on a
// separate tab for the same reason. A curated list, not derivable from the data.
const SPECIALTY_AOR = new Set([
  "aor_camillan", "aor_euzonoi", "aor_deuteroi", "aor_oscan_southern", "aor_thracian_hillmen",
]);

function classify(tags, res) {
  const g = {
    trade: [], farm: [], terrain: [], climate: [], irrigation: [], religion: [],
    recruitment: [], specialty: [], port: [], culture: [], hazard: [], geography: [], other: [],
  };
  for (const t of tags) {
    const l = t.toLowerCase();
    if (/^farm\d+$/i.test(t)) g.farm.push(t);
    else if (/^rel_/.test(l)) g.religion.push(t);
    else if (SPECIALTY_AOR.has(l)) g.specialty.push(t);
    else if (/^aor_/.test(l)) g.recruitment.push(t);
    else if (/^homeland_/.test(l)) g.culture.push(t);
    else if (/^base_port_level_\d+$/.test(l) || /port|harbour|harbor/.test(l)) g.port.push(t);
    else if (TERRAIN_TAGS.has(l)) g.terrain.push(t);
    else if (CLIMATE_TAGS.has(l)) g.climate.push(t);
    else if (IRRIGATION_TAGS.has(l)) g.irrigation.push(t);
    else if (l === "earthquake" || l === "rivertrade") g.hazard.push(t);
    else if (res.tradeable.has(l) || l === "seatrade") g.trade.push(t);
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
// Each building chain has its own page (gen-ris-building-pages.js writes one per chain, named
// for the chain's internal token). Region pages listed the chain as plain text, so a reader
// looking at what a settlement has built had no way through to what those buildings actually
// do — the pages existed but nothing pointed at them.
const buildingPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "buildings")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
// Chain page filenames are lowercased, so the lookup must be too. Four chains carry a capital
// — governmentA..D — and they were the only ones that failed, which is why the government
// levels ("Homeland", "Indirect Rule") were the ones showing up unlinked.
const chainPage = (chain) => {
  const c = String(chain || "").toLowerCase();
  return buildingPages.has(c) ? c : null;
};
const chainLink = (chain) => {
  const label = String(chain).replace(/_/g, " ");
  const p = chainPage(chain);
  return p ? `[${label}](../buildings/${p}.md)` : label;
};

/**
 * A built LEVEL, linked to the page describing it. The level name was plain text while only the
 * chain beside it was a link, so "Homeland" and "Indirect Rule" looked like dead ends even
 * though the chain page documents exactly what they do. Both cells now lead to the same page —
 * the level is what a reader recognises and therefore what they click.
 */
const levelLink = (b) => {
  const name = bName(b.level);
  const p = chainPage(b.chain);
  // No internal token: the wiki is for players, and the display name is the whole answer. The
  // token is only shown when there is no name for the level, where it is the sole identifier.
  const label = name ? `**${name}**` : `\`${b.level}\``;
  return p ? `[${label}](../buildings/${p}.md)` : label;
};

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
    // The AMOUNT is the line's second field, not the number of markers. Counting markers
    // reported "1" for almost everything, because most regions carry one marker per good — the
    // quantity on it is what varies, and it runs 1 to 5 across the file (3,220 / 1,732 / 468 /
    // 106 / 21). RIS even keeps an `original_overrides/resource_quantity/` copy of this file,
    // which is what the field is called.
    const qty = parseInt(m[2], 10);
    e.set(type, (e.get(type) || 0) + (Number.isFinite(qty) ? qty : 1));
  }
  return { out, placed, resolved, checked, agreed };
}
const MAP_RESOURCES = loadMapResources();

// Every region carries one baseline `slaves` resource, so listing it says nothing about the
// region — only a surplus above that baseline is worth showing. Verified rather than assumed:
// the count below is printed each run, and if some region ever lacks the baseline it will show
// up there instead of being silently adjusted.
const SLAVE_BASELINE = 1;
let slaveBaselineOnly = 0, slaveSurplus = 0, slaveMissing = 0;
function goodsOf(region) {
  const raw = MAP_RESOURCES.out.get(region) || new Map();
  const out = [];
  for (const [type, amount] of raw) {
    if (type !== "slaves") { out.push([type, amount]); continue; }
    const surplus = amount - SLAVE_BASELINE;
    if (surplus > 0) { slaveSurplus++; out.push([type, surplus]); }
    else slaveBaselineOnly++;
  }
  if (!raw.has("slaves")) slaveMissing++;
  return out.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ── readable tag names ───────────────────────────────────────────────────────
// Every region tag was printed as a bare token: `rivertrade`, `rel_dorian_4`,
// `base_port_level_2`, `aor_akarnanian`. Trade goods have real names in text/resources.txt,
// keyed SMT_RESOURCE_<GOOD>, so those are looked up. The rest have no text entry anywhere in
// the mod, so they are humanised from the token itself — prefix stripped, underscores out —
// with the raw token still shown, because it is what a modder searches the files for.
const RESOURCE_NAMES = loadDisplayNames("resources.txt");
// The key declared by the resource itself wins; `smt_resource_<token>` is only a fallback for
// anything descr_sm_resources does not declare. Counted so the report can say which path was
// used rather than implying every name is authoritative.
// Counted as DISTINCT TOKENS, not as calls: tagLabel() routes every region tag through here,
// so `river_valley` asks for a resource name and correctly gets none. Only tokens
// descr_sm_resources actually declares can be a miss, so only those are counted as one.
const resNameVia = { declared: new Set(), convention: new Set(), none: new Set() };
const resName = (tok) => {
  const t = String(tok).toLowerCase();
  const key = res.meta[t] && res.meta[t].nameKey;
  if (key && RESOURCE_NAMES[key]) { resNameVia.declared.add(t); return RESOURCE_NAMES[key]; }
  if (RESOURCE_NAMES[`smt_resource_${t}`]) { resNameVia.convention.add(t); return RESOURCE_NAMES[`smt_resource_${t}`]; }
  if (res.meta[t]) resNameVia.none.add(t);
  return null;
};

// Ethnicity / belief display names. The mod localises them as `{<TOKEN>_LABEL}` in
// text/expanded_bi.txt, under its own heading "BIReligion Cultures (Beliefs)" — so `indo_greek`
// is "Indo-Greek" and `delmato_pannonian` is "Delmato-Pannonian", neither of which humanising
// the token produces. One key spells the separator with a hyphen instead of an underscore
// (DELMATO-PANNONIAN_LABEL), hence the second attempt. All 51 tokens used by descr_regions
// resolve; the counter below would say so if that ever stopped being true.
const BI_NAMES = loadDisplayNames("expanded_bi.txt");
const ethNameVia = { declared: new Set(), none: new Set() };
const ethName = (tok) => {
  const t = String(tok).toLowerCase();
  const hit = BI_NAMES[`${t}_label`] || BI_NAMES[`${t.replace(/_/g, "-")}_label`];
  if (hit) { ethNameVia.declared.add(t); return hit; }
  ethNameVia.none.add(t);
  return null;
};

// Same bar as the unit pages use for stat ranks (scripts/gen-ris-unit-pages.js, `bar`):
// backticked block characters so the cells line up in a monospace column, with the number
// beside it. Deliberately NOT a <div> with a width — GitHub strips style attributes, so a CSS
// bar renders as nothing on Pages.
const BAR_CELLS = 10;
const bar = (pct) => {
  const filled = Math.max(1, Math.min(BAR_CELLS, Math.round((pct / 100) * BAR_CELLS)));
  return `\`${"█".repeat(filled)}${"·".repeat(BAR_CELLS - filled)}\``;
};

// ── trade-good icons ─────────────────────────────────────────────────────────
// Written by this generator, from the icon path each resource declares for itself. Reuses
// scripts/lib/tgaPng.js: these are 32bpp RLE TGAs with a real alpha channel, and the
// hand-rolled 24bpp reader that predates that module produced colour stripes on exactly this
// class of file while throwing nothing at all.
const { convert: convertTga } = require(path.join(__dirname, "lib", "tgaPng.js"));
const ICON_SCALE = 3;   // source art is 360x360; the pages show it at 24px
function writeResourceIcons(tokens) {
  const dir = path.join(OUT, "resource-icons");
  fs.mkdirSync(dir, { recursive: true });
  const map = {};
  const noDeclaration = [], fileMissing = [], failed = [];
  let written = 0, bytes = 0;
  for (const tok of [...tokens].sort()) {
    const m = res.meta[tok];
    if (!m || !m.icon) { noDeclaration.push(tok); continue; }
    // The declared path is relative to the MOD ROOT ("data/ui/resources/…"), while RIS points
    // at <root>/data, so the leading "data/" has to come off rather than be joined twice.
    const rel = m.icon.replace(/\\/g, "/");
    const file = /^data\//i.test(rel) ? path.join(RIS, rel.slice(5)) : path.join(RIS, "..", rel);
    if (!fs.existsSync(file)) { fileMissing.push(`${tok} -> ${rel}`); continue; }
    try {
      const r = convertTga(dg, file, ICON_SCALE);
      if (!r) { failed.push(tok); continue; }
      fs.writeFileSync(path.join(dir, `${tok}.png`), r.buf);
      map[tok] = `resource-icons/${tok}.png`;
      written++; bytes += r.buf.length;
    } catch { failed.push(tok); }
  }
  return { map, written, bytes, noDeclaration, fileMissing, failed };
}

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
  // The name REPLACES the token: "Dorian 4 rel_dorian_4" says it twice, and the token is the
  // half a player does not need. Where humanising only changes capitalisation there is nothing
  // to add, so the token stands on its own rather than being dressed up as a name.
  return nice.toLowerCase() === raw.toLowerCase() ? `\`${raw}\`` : nice;
}

// State the mechanism and where to check it, not an opinion about it. The previous wording —
// "Provincia's own measurements found RIS cancels farm fertility almost exactly" — read as a
// complaint that something was inexact, when the cancellation is deliberate and exact: RIS's
// `hinterland_region` chain carries 14 lines under a `;BASE GROWTH` comment,
// `population_growth_bonus bonus -N requires hidden_resource farmN` for farm1..farm14. That
// bonus is in half-percent units, so -N is -0.5N% and cancels the engine's hardcoded
// +0.5xfarmN exactly. Anyone can verify it in the file.
const FARM_NOTE = "Fertility does not drive population growth in RIS. The engine adds " +
  "+0.5% growth per fertility point, and the `hinterland_region` building subtracts the same " +
  "amount back (`population_growth_bonus -N` for `farmN`, under BASE GROWTH in " +
  "export_descr_buildings.txt), so the two cancel by design. Fertility still describes the " +
  "land; it is growth specifically that it does not change.";

// What the digit on a `rel_<belief>_N` tag actually is, checked in the file that consumes it.
// The pages used to print the tag humanised — "Egyptian 4, Macedonian 1" — which reads as
// 4% and 1%. It is not a share of anything: it is a 1-4 strength tier, and
// export_descr_buildings.txt scales a `religious_belief` bonus by it, e.g.
//   religious_belief venetic 2 requires hidden_resource rel_venetic_1     (hinterland_region)
//   religious_belief venetic 8 requires hidden_resource rel_venetic_4
//   religious_belief venetic 4 requires hidden_resource rel_venetic_1     (governmentA)
//   religious_belief venetic 16 requires hidden_resource rel_venetic_4
// The `religion_present_<belief>` aliases near the top of the same file treat any of the four
// tiers as "present", so the tier is about strength, not presence.
const RELIGION_NOTE = "The number on a `rel_…` tag is a **1-4 strength tier, not a percentage**. " +
  "RIS scales the `religious_belief` a region generates by it — `hinterland_region` grants 2/4/6/8 " +
  "for tiers 1/2/3/4, and the government chains grant 4/8/12/16 (export_descr_buildings.txt). " +
  "Any tier counts as the belief being present. The percentages on the People row are a " +
  "different thing entirely: they come from the region's own ethnicities field and sum to 100.";

// ── build ────────────────────────────────────────────────────────────────────
const regions = loadRegions();
if (!regions.length) { console.error("no regions parsed — check descr_regions.txt"); process.exit(2); }

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

// Only the goods that actually appear on a page get an icon written, so the folder cannot
// fill up with art nothing references.
const NEEDED_GOODS = new Set();
for (const r of list) for (const tok of (MAP_RESOURCES.out.get(r.region) || new Map()).keys()) NEEDED_GOODS.add(tok);
const RES_ICONS = writeResourceIcons(NEEDED_GOODS);
const goodIcon = (tok) => (RES_ICONS.map[tok] ? `<img src="../${RES_ICONS.map[tok]}" alt="" width="24">` : "");

let withMapGoods = 0, withOwner = 0, withBuildings = 0, withTrade = 0;
let withEthnicities = 0, withoutEthnicities = 0;
const unparseableEth = [];
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
  const goods = goodsOf(r.region);
  const goodsLabel = goods.map(([type, n]) =>
    `${resName(type) || humanise(type)}${n > 1 ? ` ×${n}` : ""}`);
  if (goods.length) withMapGoods++;

  // Who lives here, as percentages. Ancestry comes from descr_regions field 7 and the shares
  // sum to 100; the belief tier comes from the region's `rel_…` tags. They are NOT the same
  // list — 1,180 of 1,311 regions name exactly the same set both ways, and the other 131 have
  // a people present with no established belief of their own (Phoenicians in Libyan Macaea) or
  // the reverse. So both are shown, and a row with no counterpart says so rather than being
  // dropped or invented.
  const relTier = {};
  for (const t of g.religion) {
    const m = /^rel_([a-z_]+)_(\d)$/i.exec(String(t));
    if (m) relTier[m[1].toLowerCase()] = { tier: parseInt(m[2], 10), tag: t };
    else relTier[String(t).toLowerCase()] = { tier: null, tag: t };   // unrecognised shape, still shown
  }
  const eth = [...r.ethnicities].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  if (eth.length) withEthnicities++;
  else { withoutEthnicities++; if (unparseableEth.length < 8) unparseableEth.push(`${r.region}: ${JSON.stringify(r.ethnicitiesRaw)}`); }
  // One row each, read as a sentence: "Indian 80%, Indo-Greek 20%". This was a three-column
  // table with a bar per people and a belief tier beside it, which spent a whole block of the
  // page on two numbers — the shares are the answer and they fit on a line.
  const pName = (k) => ethName(k) || humanise(k);
  const peopleLine = eth.length
    ? eth.map((e) => `${pName(e.name)} ${e.pct}%`).join(", ") : null;
  const beliefLine = Object.keys(relTier).length
    ? Object.entries(relTier)
      .sort((a, b) => (b[1].tier || 0) - (a[1].tier || 0) || a[0].localeCompare(b[0]))
      .map(([k, rt]) => (rt.tier == null ? `\`${rt.tag}\`` : `${pName(k)} ${rt.tier}/4`))
      .join(", ")
    : null;

  const glance = [
    `**Settlement:** ${r.settlement}`,
    held ? `**Size:** ${String(held.level || "").replace(/_/g, " ")}` : null,
    held && held.pop != null ? `**Population:** ${held.pop.toLocaleString("en-US")}` : null,
    eth.length ? `**People:** ${eth.map((e) => `${ethName(e.name) || humanise(e.name)} ${e.pct}%`).join(", ")}` : null,
    goodsLabel.length ? `**Trade goods:** ${goodsLabel.join(", ")}` : null,
  ].filter(Boolean).join(" · ");

  if (peopleLine) rows.push(`| People | ${peopleLine} |`);
  // No explanatory note. The tier reads as "4/4" and that is enough on a player-facing page;
  // the mechanics of how RIS scales religious_belief are documented at RELIGION_NOTE above for
  // anyone reading this generator, and do not belong on 1,311 region pages.
  if (beliefLine) rows.push(`| Beliefs | ${beliefLine} |`);
  addRow("Region resource tags", g.trade);
  // Fertility is the Farm## tag on a 1-14 scale, NOT descr_regions field 7 — RIS leaves that
  // field at a constant 5 for every region as a placeholder, so reporting it would give the
  // same answer 1,311 times. Provincia's region panel reads the tag for the same reason.
  if (g.farm.length) {
    const v = parseInt(String(g.farm[0]).replace(/\D+/g, ""), 10);
    rows.push(`| Fertility | **${v}** / 14 \`${g.farm[0]}\` |`);
    rows.push(`| | _${FARM_NOTE}_ |`);
  }
  addRow("Terrain", g.terrain);
  addRow("Climate", g.climate);
  addRow("Irrigation", g.irrigation);
  addRow("Port", g.port);
  // Religion is NOT a row here any more: humanised, `rel_egyptian_4` printed as "Egyptian 4",
  // which reads as a percentage and is a strength tier. It has its own column in "Who lives
  // here", next to the real percentages, with RELIGION_NOTE explaining the scale. Nothing is
  // dropped — every rel_ tag on the region appears there, including any that does not match
  // the `rel_<belief>_<tier>` shape.
  addRow("Recruitment zones", g.recruitment);
  addRow("Specialty recruitment", g.specialty);
  addRow("Cultural homeland", g.culture);
  addRow("Hazards and river trade", g.hazard);
  addRow("Geography and gating", g.geography);
  addRow("Other tags", g.other);

  const body = `# ${r.region}

[← all regions](../regions.md) · [wiki index](../README.md)

${glance}

${held ? `Held at the campaign start by ${hasPage(held.faction) ? `[${facName(held.faction)}](../factions/${held.faction}.md)` : facName(held.faction)}${held.capital ? " — **their capital**" : ""}.` : `This region begins **independent**. If it revolts, the rebels are ${r.rebels}.`}

## Trade goods

${goods.length
  ? `| | Trade good | Amount |\n|:-:|---|---:|\n${goods.map(([type, n]) => `| ${goodIcon(type)} | **${resName(type) || humanise(type)}** | ${n} |`).join("\n")}`
  : "_No trade goods are placed inside this region._"}

## Resources and character

${rows.length ? `| | |\n|---|---|\n${rows.join("\n")}` : "_This region carries no tags._"}

## What is already built

${held && (held.buildings || []).length
  ? `| | Building chain | Level |\n|:-:|---|---|\n${held.buildings.map((b) => `| ${(() => { const ic = iconFor(held.faction, b.level); return ic ? `<img src="../${ic}" alt="" width="32">` : ""; })()} | ${chainLink(b.chain)} | ${levelLink(b)} |`).join("\n")}`
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
console.log(`  slaves: ${slaveBaselineOnly.toLocaleString("en-US")} regions have the baseline only (hidden), ${slaveSurplus.toLocaleString("en-US")} have a surplus (shown), ${slaveMissing.toLocaleString("en-US")} have none at all`);
console.log(`  regions with trade goods:  ${withMapGoods.toLocaleString("en-US")}`);
console.log(`  with a trade resource:      ${withTrade}`);
console.log(`  resource vocabulary read:   ${res.tradeable.size} tradeable, ${res.hidden.size} hidden`);
console.log(`  resource names (distinct tokens): ${resNameVia.declared.size} via the key the resource declares, ${resNameVia.convention.size} via smt_resource_<token>, ${resNameVia.none.size} declared resources with no text entry${resNameVia.none.size ? ` (${[...resNameVia.none].join(", ")})` : ""}`);

console.log(`\nancestry (descr_regions field 7, "<people> <pct>" pairs):`);
console.log(`  parsed:     ${withEthnicities.toLocaleString("en-US")} regions`);
console.log(`  unparseable or absent: ${withoutEthnicities.toLocaleString("en-US")}${unparseableEth.length ? ` — e.g. ${unparseableEth.join("; ")}` : ""}`);
console.log(`  people display names (distinct tokens): ${ethNameVia.declared.size} from text/expanded_bi.txt <TOKEN>_LABEL, ${ethNameVia.none.size} with no entry (token humanised)${ethNameVia.none.size ? ` — ${[...ethNameVia.none].join(", ")}` : ""}`);

console.log(`\ntrade-good icons -> ${path.join(OUT, "resource-icons")} (1/${ICON_SCALE} of the source art):`);
console.log(`  goods referenced by a page: ${NEEDED_GOODS.size}`);
console.log(`  written:                    ${RES_ICONS.written} (${(RES_ICONS.bytes / 1024).toFixed(0)} KB)`);
console.log(`  no "icon" declared:         ${RES_ICONS.noDeclaration.length}${RES_ICONS.noDeclaration.length ? ` (${RES_ICONS.noDeclaration.join(", ")})` : ""}`);
console.log(`  declared file not on disk:  ${RES_ICONS.fileMissing.length}${RES_ICONS.fileMissing.length ? ` (${RES_ICONS.fileMissing.join(", ")})` : ""}`);
// "failed" means the decoder threw or returned nothing. It does NOT mean the images are
// right: a 32bpp source read as 24bpp produced correctly-sized colour-stripe garbage without
// throwing once, across 1,132 files. Only opening one shows that.
console.log(`  threw while decoding:       ${RES_ICONS.failed.length}${RES_ICONS.failed.length ? ` (${RES_ICONS.failed.join(", ")})` : ""}  <- a zero here means nothing threw, not that the art is correct; open one and look`);
