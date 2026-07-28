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
    // Only the declared port LEVELS, which is the test src/RegionInfo.js uses. The looser
    // /port|harbour|harbor/ this used to carry matched exactly one other token in the whole
    // mod — `merc_center_no_port`, a mercenary-centre flag — and put "Merc center no port" on
    // the Port row of 15 regions, where it is neither a port nor a level. It falls through to
    // geography and gating with the rest of the mercenary tags now.
    else if (/^base_port_level_\d+$/.test(l)) g.port.push(t);
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
// Region and settlement DISPLAY names. descr_regions names a region `Achaia_Phthiotis` and its
// settlement `Thebai_Phthiotides`, and those tokens are keys, not names — the mod localises
// every one of them in text/imperial_campaign_regions_and_settlement_names.txt, which is the
// file the game itself reads to label the map. Replacing the underscore with a space happens to
// give the same answer for most of them, but it is a guess dressed as a fact, and it is the
// mod's file that decides. The link TARGET stays the token, because that is what the page is
// called on disk; only the visible text changes. Counted below: 354 of the 1,311 region tokens
// carry an underscore, so this is a third of the index.
const PLACE_NAMES = loadDisplayNames("imperial_campaign_regions_and_settlement_names.txt");
const placeNameVia = { declared: 0, fallback: new Set() };
const placeName = (tok) => {
  const hit = PLACE_NAMES[String(tok).toLowerCase()];
  if (hit) { placeNameVia.declared++; return hit; }
  placeNameVia.fallback.add(String(tok));
  return String(tok).replace(/_/g, " ");
};

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

/**
 * descr_beliefs.txt — the file that DECLARES each of these peoples, and the only reason the
 * People row can carry an icon at all.
 *
 * Each block gives the belief a `"religion icon"` path and a `"name"` key, exactly the way
 * descr_sm_resources.txt gives a trade good an icon and a name key. So neither has to be
 * guessed from the token, and the name lookup below now asks the file first and falls back to
 * the `<TOKEN>_LABEL` convention only for anything the file does not declare.
 *
 * TWO TRAPS, both hit while writing this:
 *
 *   1. THE BLOCKS ARE NOT ALL AT THE SAME INDENT. Eleven Anatolian peoples — Mysian, Lydian,
 *      Carian, Lycian, Pamphylian, Pisidian, Phrygian, Paphlagonian, Lycaonian, Isaurian,
 *      Cilician, Cappadocian — are written one tab deeper than the rest, under `"anatolian"`.
 *      A pattern anchored on a single tab finds 41 of the 53 and every one of those twelve is a
 *      people descr_regions actually uses, so the icons would have been missing exactly where
 *      the map needs them. The block is recognised by its CONTENT — the `"religion icon"` line
 *      it carries — rather than by its indentation.
 *
 *   2. THE VOCABULARY IS NOT THE SAME AS descr_regions'. The map uses 51 people tokens and the
 *      belief file declares 53. All 51 are declared; the two spare are `anatolian` and `greek`,
 *      which are the umbrella entries the finer-grained peoples sit under. Counted on every run.
 */
const BELIEFS = (() => {
  const out = {};
  let cur = null;
  for (const raw of (rd("descr_beliefs.txt") || "").split(SPLIT_EOL)) {
    const line = raw.replace(/;;.*$/, "").replace(/\r$/, "");
    let m = /^\s+"([a-z0-9_\-]+)"\s*:\s*$/.exec(line);
    if (m) { cur = { tok: m[1].toLowerCase() }; continue; }
    if (!cur) continue;
    m = /"religion icon"\s*:\s*"([^"]+)"/.exec(line);
    if (m) { cur.icon = m[1]; out[cur.tok] = cur; continue; }
    m = /"name"\s*:\s*"([^"]+)"/.exec(line);
    if (m && out[cur.tok] && !out[cur.tok].nameKey) out[cur.tok].nameKey = m[1].toLowerCase();
  }
  return out;
})();
const ethNameVia = { declared: new Set(), convention: new Set(), none: new Set() };
const ethName = (tok) => {
  const t = String(tok).toLowerCase();
  const key = BELIEFS[t] && BELIEFS[t].nameKey;
  if (key && BI_NAMES[key]) { ethNameVia.declared.add(t); return BI_NAMES[key]; }
  const hit = BI_NAMES[`${t}_label`] || BI_NAMES[`${t.replace(/_/g, "-")}_label`];
  if (hit) { ethNameVia.convention.add(t); return hit; }
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

// ── belief icons ─────────────────────────────────────────────────────────────
// The People row on a region page is a list of names and percentages and it is the row a reader
// is most often scanning for. The mod has a pip for each of those peoples and declares the path
// itself, so the icon goes in front of the name — the same trade this generator already makes
// for a trade good. Written from here, not from a second generator, because one owner per output
// directory is what keeps the collision check in verify-ris-wiki.js meaningful.
//
// Scale 1: the sources measure 90x90 and the whole set is 259 KB, so downscaling would save a
// quarter of a megabyte across the wiki and cost the shape on a high-density display. The run
// output prints the dimensions, so that trade-off stays a measured one.
const BELIEF_ICON_SCALE = 1;
function writeBeliefIcons(tokens) {
  const dir = path.join(OUT, "belief-icons");
  fs.mkdirSync(dir, { recursive: true });
  const map = {};
  const noDeclaration = [], fileMissing = [], failed = [];
  let written = 0, bytes = 0, w = 0, h = 0;
  for (const tok of [...tokens].sort()) {
    const b = BELIEFS[tok];
    if (!b || !b.icon) { noDeclaration.push(tok); continue; }
    const rel = b.icon.replace(/\\/g, "/");
    const file = /^data\//i.test(rel) ? path.join(RIS, rel.slice(5)) : path.join(RIS, "..", rel);
    if (!fs.existsSync(file)) { fileMissing.push(`${tok} -> ${rel}`); continue; }
    try {
      const r = convertTga(dg, file, BELIEF_ICON_SCALE);
      if (!r) { failed.push(tok); continue; }
      fs.writeFileSync(path.join(dir, `${tok}.png`), r.buf);
      map[tok] = `belief-icons/${tok}.png`;
      written++; bytes += r.buf.length; w = r.w; h = r.h;
    } catch { failed.push(tok); }
  }
  return { map, written, bytes, noDeclaration, fileMissing, failed, w, h };
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

// ── links into the tag reference pages ───────────────────────────────────────
// Every value on the "Resources and character" table used to be a dead end: a page said
// `Terrain — River valley` and there was nowhere to go to find out what that decides.
// gen-ris-tag-pages.js writes one page per category and publishes tags/index.json mapping each
// token to its page and heading anchor. Read rather than recomputed: this generator humanises
// tokens with its own copy of the same rules, and a one-character disagreement would send every
// link to a heading that is not there — which nothing would catch, because verify-ris-wiki.js
// checks that the FILE exists, not the fragment.
let TAG_ANCHORS = {};
try { TAG_ANCHORS = JSON.parse(fs.readFileSync(path.join(OUT, "tags", "index.json"), "utf8")); }
catch { /* run gen-ris-tag-pages.js first; until then the values are plain text as before */ }

// Beliefs and cultures, the same arrangement again: gen-ris-belief-pages.js and
// gen-ris-culture-pages.js each write a page per value and publish an index of the page name
// and the heading it is titled with. Read rather than recomputed, for the reason written above:
// this generator humanises the same tokens with its own copy of the rules, and a one-character
// disagreement would send a link to a page that is not there.
let BELIEF_INDEX = {};
try { BELIEF_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "religions", "index.json"), "utf8")); }
catch { /* run gen-ris-belief-pages.js first; until then the peoples are plain text as before */ }
let CULTURE_INDEX = {};
try { CULTURE_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "cultures", "index.json"), "utf8")); }
catch { /* run gen-ris-culture-pages.js first; until then the culture is plain text as before */ }
let beliefLinked = 0; const beliefUnlinked = new Set();
let cultureLinked = 0; const cultureUnlinked = new Set();
/** A people, named and linked to the belief page that says what it is. `rel` is the prefix. */
function beliefRef(tok, label, rel) {
  const e = BELIEF_INDEX[String(tok).toLowerCase()];
  if (!e) { if (Object.keys(BELIEF_INDEX).length) beliefUnlinked.add(String(tok).toLowerCase()); return label; }
  beliefLinked++;
  return `[${label}](${rel}religions/${e.page})`;
}
/** The owning faction's culture, linked to the page that says what that culture decides. */
function cultureRef(tok, rel) {
  if (!tok) return null;
  const e = CULTURE_INDEX[String(tok).toLowerCase()];
  if (!e) { if (Object.keys(CULTURE_INDEX).length) cultureUnlinked.add(String(tok).toLowerCase()); return null; }
  cultureLinked++;
  return `[${e.name}](${rel}cultures/${e.page})`;
}

// Settlement sizes, the same arrangement one level up: gen-ris-settlement-sizes.js writes a page
// per rung of the ladder and publishes sizes/index.json mapping each size token to its page and
// the display name the page is headed with. Read rather than recomputed, and the display name
// comes from there too — the size names are the mod's own (`{ST_LARGE_TOWN}` in
// text/shared.txt reads "Large town"), and this generator was printing `large_town` with the
// underscore knocked out, which is a guess that happens to look right.
let SIZE_INDEX = {};
try { SIZE_INDEX = JSON.parse(fs.readFileSync(path.join(OUT, "sizes", "index.json"), "utf8")); }
catch { /* run gen-ris-settlement-sizes.js first; until then the size is plain text as before */ }
let sizeLinked = 0;
const sizeUnlinked = new Set();
/** The settlement's size, linked to the page saying what that size decides. `rel` is the prefix. */
function sizeRef(level, rel) {
  const tok = String(level || "").toLowerCase().replace(/\s+/g, "_");
  if (!tok) return null;
  const e = SIZE_INDEX[tok];
  if (!e) { if (Object.keys(SIZE_INDEX).length) sizeUnlinked.add(tok); return String(level).replace(/_/g, " "); }
  sizeLinked++;
  return `[${e.name}](${rel}sizes/${e.page})`;
}
let tagLinked = 0, tagUnlinked = new Set();
function tagRef(tok) {
  const a = TAG_ANCHORS[String(tok).toLowerCase()];
  if (!a) { if (Object.keys(TAG_ANCHORS).length) tagUnlinked.add(String(tok).toLowerCase()); return tagLabel(tok); }
  tagLinked++;
  // The label is the reference page's OWN heading, not this generator's humanising of the
  // token. Two things follow from that. The link text always matches the heading it lands on.
  // And a one-word tag stops printing as `forest` in backticks — tagLabel falls back to the
  // raw token when humanising only changes the capitalisation, which put internal tokens on
  // the Terrain and Climate rows of every page that had them.
  return `[${a.name}](../tags/${a.page}#${a.anchor})`;
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
// `slave` holds 502 of the 1,311 regions at the campaign start, and campaign_descriptions has
// no title for it — so `facName` fell back to the raw token and the commonest owner on the map
// was printed as the word "slave", unlinked. The mod does name it: `{SLAVE}` in
// text/expanded_bi.txt reads "Free Peoples", which is what the game shows. The other eight
// non-playable factions are named the same way, and all nine are documented on one shared page,
// which is where the link goes — they have no page each, by design.
const npNameVia = { declared: new Set(), fallback: new Set() };
const npName = (f) => {
  const k = String(f).toLowerCase();
  const hit = BI_NAMES[k];
  if (hit) { npNameVia.declared.add(k); return hit; }
  npNameVia.fallback.add(k);
  return String(f).replace(/_/g, " ");
};
let npCells = 0;
const nonPlayableRef = (f) => { npCells++; return `[${npName(f)}](../factions/non-playable.md)`; };
const facName = (f) => display[String(f).toLowerCase()] || npName(f);

// ── what can be recruited here, at the campaign start ────────────────────────
// gen-ris-faction-pages.js deliberately does NOT evaluate recruitment, because "can this
// faction build this" needs a settlement and a turn. A REGION page at turn 0 has both, and
// everything else the conditions ask about:
//
//   factions { … }                 the owner is in descr_strat
//   hidden_resource <tag>          the region's tags are in descr_regions
//   building_present[_min_level]   what is built is in descr_strat
//   resource <good>                the goods placed inside the region, resolved through the
//                                  region map above
//   alias <name>                   expanded to the condition it stands for, never treated as
//                                  an opaque token
//
// A RECRUIT LINE BELONGS TO THE LEVEL IT IS WRITTEN UNDER, and only that level's block
// applies. Checked in the file rather than assumed: the military chain's four levels declare
// 987 / 1,037 / 1,060 / 1,065 recruit lines and each set is a superset of the one below, so
// every level restates what it keeps. If capabilities accumulated up the chain that
// restatement would be pointless.
//
// TWO THINGS TURN 0 CANNOT DECIDE, and neither is guessed at:
//   `is_player` — depends on who is playing. The region's owner is taken to be the player,
//                 which is the only reading under which a region page means anything. It also
//                 removes the `not is_player` lines, which are the AI's free garrison roster.
//   `major_event "…"` — a reform. Each event's own trigger script is read and the event is
//                 only ruled out when the script provably cannot fire at turn 0; where it
//                 cannot be ruled out the units are listed separately with the reform named.
const RC = require(path.join(__dirname, "lib", "edbRecruit.js"));
const EDB_TXT = rd("export_descr_buildings.txt") || "";
const EDB_ALIASES = RC.parseAliases(EDB_TXT);
const EDB = RC.parseEdb(EDB_TXT);
const CHAIN_TAGS = RC.chainTagsOf(EDB_TXT);
const CHAIN_ORDER = new Map(EDB.chains.map((c) => [c.chain.toLowerCase(), c.order.map((x) => x.toLowerCase())]));
const SETTLE = RC.settlementRanks(rd("descr_sm_settlements.txt") || "");
const RECRUIT_AT = (() => {
  const m = new Map();
  for (const r of EDB.recruits) {
    const k = `${r.chain.toLowerCase()}/${String(r.level).toLowerCase()}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
})();

// Unit display names and page slugs: EDU `type` -> `dictionary` -> text/export_units.txt, the
// same two hops gen-ris-unit-pages.js makes, so a link here lands on the page it names.
const UNIT_TEXT = loadDisplayNames("export_units.txt");
const UNIT_INFO = (() => {
  const out = {};
  let type = null, dict = null, cost = null, upkeep = null;
  const flush = () => { if (type) out[type] = { dict, cost, upkeep }; type = dict = cost = upkeep = null; };
  for (const raw of (rd("export_descr_unit.txt") || "").split(SPLIT_EOL)) {
    const t = raw.replace(/;.*$/, "").trim();
    let m = /^type\s+(.+)$/.exec(t);
    if (m) { flush(); type = m[1].trim().toLowerCase(); continue; }
    m = /^dictionary\s+(\S+)/.exec(t);
    if (m) { dict = m[1].toLowerCase(); continue; }
    // `stat_cost  <recruit turns>, <cost>, <upkeep>, …` — the second and third fields.
    m = /^stat_cost\s+(.+)$/.exec(t);
    if (m) { const f = m[1].split(",").map((s) => parseInt(s.trim(), 10)); cost = f[1]; upkeep = f[2]; continue; }
  }
  flush();
  return out;
})();
const uSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const unitPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "units")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
const cardFiles = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "cards")).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""))); }
  catch { return new Set(); }
})();

// Which reforms can be ruled out at turn 0, and what each is called. Only ever used to rule
// one OUT — see majorEventInactiveAtTurn0 in the shared library, which refuses anything it
// cannot prove.
const MAJOR_EVENTS = RC.parseMajorEvents(rd("descr_sm_major_events.txt") || "");
const EVENT_TEXT = loadDisplayNames("major_events.txt");
const settlementsOf = (fac) => ((strat[String(fac).toLowerCase()] || {}).settlements || []).length;
const EVENT_INACTIVE = new Map();
for (const [name, e] of Object.entries(MAJOR_EVENTS)) {
  let src = null;
  try { src = fs.readFileSync(path.join(RIS, e.script), "latin1"); } catch { /* missing script */ }
  EVENT_INACTIVE.set(name, src == null ? null : RC.majorEventInactiveAtTurn0(src, settlementsOf));
}
const eventName = (tok) => {
  const e = MAJOR_EVENTS[String(tok).toLowerCase()];
  const n = e && e.titleKey ? EVENT_TEXT[e.titleKey] : null;
  return n || String(tok).replace(/_/g, " ");
};

// Every hidden resource anywhere in a faction's territory, for `… factionwide` conditions.
const FACTION_TAGS = (() => {
  const out = new Map();
  const tagsByRegion = new Map(regions.map((r) => [r.region, r.tags.map((t) => t.toLowerCase())]));
  for (const [fac, v] of Object.entries(strat)) {
    const s = new Set();
    for (const st of (v.settlements || [])) for (const t of (tagsByRegion.get(st.region) || [])) s.add(t);
    out.set(fac, s);
  }
  return out;
})();

const recruitStats = {
  evaluated: 0, noMilitary: 0, zeroNow: 0, now: 0, conditional: 0, ambiguous: 0, build: 0,
  undecided: new Map(),
};
/**
 * @returns { now: [row], later: [row] } — `now` is every unit whose condition is true against
 * turn-0 state; `later` is every unit whose condition could not be decided, each carrying the
 * clause that decides it.
 */
function recruitableAt(r, held) {
  if (!held) return null;
  const built = new Map();
  for (const b of (held.buildings || [])) built.set(String(b.chain).toLowerCase(), String(b.level).toLowerCase());
  const ctx = {
    faction: held.faction,
    isPlayer: true,
    tags: new Set(r.tags.map((t) => t.toLowerCase())),
    factionTags: FACTION_TAGS.get(held.faction),
    built,
    goods: new Set((MAP_RESOURCES.out.get(r.region) || new Map()).keys()),
    chainOrder: CHAIN_ORDER,
    chainTags: CHAIN_TAGS,
    settlementLevel: held.level,
    settlementRank: SETTLE.rank,
    // false only where the event's own trigger script provably cannot fire at turn 0; null
    // (undecided) otherwise, which is what puts a unit in the conditional list by name.
    majorEvent: (name) => (EVENT_INACTIVE.get(name) === "inactive" ? false : null),
  };
  const now = new Map(), later = new Map();
  for (const [chain, level] of built) {
    for (const line of (RECRUIT_AT.get(`${chain}/${level}`) || [])) {
      const v = RC.evaluate(line.requires, ctx, EDB_ALIASES);
      if (v.value === false) continue;
      const info = UNIT_INFO[line.unit] || {};
      const key = info.dict || `type:${line.unit}`;
      const at = bName(line.level) || String(line.level).replace(/_/g, " ");
      if (v.value === true) {
        if (!now.has(key)) now.set(key, { unit: line.unit, info, at: new Set() });
        now.get(key).at.add(`${line.chain}|${at}`);
        continue;
      }
      if (v.ambiguous) recruitStats.ambiguous++;
      for (const u of v.unknown) {
        const k = u.replace(/"[^"]*"/, '"…"');
        recruitStats.undecided.set(k, (recruitStats.undecided.get(k) || 0) + 1);
      }
      if (!later.has(key)) later.set(key, { unit: line.unit, info, at: new Set(), why: new Set(), ambiguous: v.ambiguous });
      const e = later.get(key);
      e.at.add(`${line.chain}|${at}`);
      for (const u of v.unknown) e.why.add(u);
      if (v.ambiguous) e.ambiguous = true;
    }
  }
  // ── what it could raise once something is BUILT ─────────────────────────────
  // Everything above only ever looked at recruit lines hanging off levels this settlement
  // already has, so "later" meant "a reform or an event we cannot decide" — 162 rows across
  // 1,311 settlements. The question a player asks is the other one: what does this place raise
  // once I put something up? So every OTHER level in the mod is tried with that level assumed
  // present, and the line's own condition does the filtering — culture, faction, area of
  // recruitment, trade goods, settlement size all still have to pass for this settlement.
  //
  // It says "once you have <level>", not "you can build <level>": whether the level is allowed
  // here is a different question, decided by terrain and culture gating this does not evaluate,
  // and claiming it would be inventing.
  const build = new Map();
  for (const [key, lines] of RECRUIT_AT) {
    const [chain, level] = key.split("/");
    if (built.get(chain) === level) continue;                 // already standing: handled above
    const ctx2 = { ...ctx, built: new Map(built).set(chain, level) };
    for (const line of lines) {
      const info = UNIT_INFO[line.unit] || {};
      const k = info.dict || `type:${line.unit}`;
      if (now.has(k) || later.has(k)) continue;               // already promised by another route
      const v = RC.evaluate(line.requires, ctx2, EDB_ALIASES);
      if (v.value !== true) continue;                         // false, or undecided: not a promise
      const at = bName(line.level) || String(line.level).replace(/_/g, " ");
      if (!build.has(k)) build.set(k, { unit: line.unit, info, at: new Set() });
      build.get(k).at.add(`${line.chain}|${at}`);
    }
  }
  for (const k of now.keys()) { later.delete(k); build.delete(k); }
  for (const k of later.keys()) build.delete(k);
  recruitStats.build += build.size;
  recruitStats.evaluated++;
  if (![...built.keys()].some((c) => c === "military_industrial_complex" || c === "garrison")) recruitStats.noMilitary++;
  if (!now.size) recruitStats.zeroNow++;
  recruitStats.now += now.size;
  recruitStats.conditional += later.size;
  return { now: [...now.values()], later: [...later.values()], build: [...build.values()] };
}

/** The condition a conditional unit is still waiting on, in words. */
function whyText(e) {
  const parts = [];
  for (const w of e.why) {
    const m = /^major_event\s+"([^"]+)"$/.exec(w);
    if (m) { parts.push(`the ${eventName(m[1])}`); continue; }
    parts.push(`\`${w}\``);
  }
  if (e.ambiguous) parts.push("a condition whose bracketing the mod does not state");
  return [...new Set(parts)].join(", ");
}

const unitName = (u) => {
  const d = (UNIT_INFO[u] || {}).dict;
  return (d && UNIT_TEXT[d]) || String(u).replace(/\b\w/g, (c) => c.toUpperCase());
};
// Card at a quarter of the source art (164x224), with BOTH dimensions set: an <img> with no
// height reflows the page as each one arrives, and 1,300 pages of that is a layout storm.
const CARD_W = 41, CARD_H = 56;
const cardImg = (u) => {
  const d = (UNIT_INFO[u] || {}).dict;
  const s = d ? uSlug(d) : null;
  return s && cardFiles.has(s) ? `<img src="../cards/${s}.png" alt="" width="${CARD_W}" height="${CARD_H}">` : "";
};
const unitRef = (u) => {
  const d = (UNIT_INFO[u] || {}).dict;
  const s = d ? uSlug(d) : null;
  const label = `**${unitName(u)}**`;
  return s && unitPages.has(s) ? `[${label}](../units/${s}.md)` : label;
};
const atCell = (set) => [...new Set([...set].map((x) => {
  const [chain, name] = x.split("|");
  const p = chainPage(chain);
  return p ? `[${name}](../buildings/${p}.md)` : name;
}))].join(", ");

// Same shape as the "What is already built" table on the same page — image, then the thing,
// then where it comes from — so a reader does not have to learn two layouts on one page.
const FOLD_AT = 12;
// A unit you cannot raise here YET is drawn greyed out, which is the difference a reader is
// looking for and the fastest one to see — no reading required. Done with an inline style
// rather than a class because these pages are rendered by three different things (the local
// viewer, the static build, and GitHub), and only one of them would honour a stylesheet of ours.
const DIMMED = ' style="filter:grayscale(1);opacity:.45"';
const cardDim = (u) => cardImg(u).replace(/<img /, `<img${DIMMED} `);
const unitRows = (rows, dim) => rows
  .sort((a, b) => unitName(a.unit).localeCompare(unitName(b.unit)))
  .map((e) => `| ${dim ? cardDim(e.unit) : cardImg(e.unit)} | ${unitRef(e.unit)} | ${atCell(e.at)} | ${e.info.cost != null ? e.info.cost.toLocaleString("en-US") : "—"} | ${e.info.upkeep != null ? e.info.upkeep.toLocaleString("en-US") : "—"} |`);
const unitTable = (rows, dim) => `| | Unit | ${dim ? "Once you have" : "Raised at"} | Cost | Upkeep |\n|:-:|---|---|---:|---:|\n${unitRows(rows, dim).join("\n")}`;
// The opening tag and the <summary> go on SEPARATE lines. Written as one line the viewer does
// not see a block and prints the tags as text, which is what happened to 60 region pages.
const maybeFold = (summary, rows, table) => (rows.length > FOLD_AT
  ? `<details>\n<summary>${summary}</summary>\n\n${table}\n\n</details>`
  : table);

function recruitSection(rec, held) {
  if (!held) return "_Independent regions have no owner, so there is nothing to evaluate._";
  if (!rec) return "_Not determined._";
  const out = [];
  if (rec.now.length) {
    out.push(maybeFold(`${rec.now.length} units, as its owner, at the campaign start`, rec.now, unitTable(rec.now)));
  } else {
    out.push("_Nothing can be raised here at the campaign start._");
  }
  if (rec.later.length) {
    // Grouped by the clause they are waiting on, so the same reform is named once.
    const byWhy = new Map();
    for (const e of rec.later) {
      const w = whyText(e) || "an undetermined condition";
      if (!byWhy.has(w)) byWhy.set(w, []);
      byWhy.get(w).push(e);
    }
    const total = rec.later.length;
    const inner = [`**${total} more ${total === 1 ? "unit is" : "units are"} raised here once something changes** — greyed out below, grouped by what each is waiting on.`]
      .concat([...byWhy.entries()].sort((a, b) => b[1].length - a[1].length)
        .map(([w, rows]) => `**Waiting on ${w}** — ${rows.length} ${rows.length === 1 ? "unit" : "units"}\n\n${unitTable(rows, true)}`))
      .join("\n\n");
    // Shown outright, not folded. This was a <details> whose opening tag and <summary> sat on
    // ONE line, which the local viewer does not recognise as a block, so "<details><summary>1
    // more once a condition is met</summary>" printed as literal text on 60 region pages. The
    // content it was hiding is one or two rows with a bold line already naming the condition, so
    // there was nothing worth folding in the first place.
    out.push(inner);
  }
  if (rec.build && rec.build.length) {
    // Grouped by the building that unlocks them, biggest group first — the reader's question is
    // "what is worth putting up here", and the answer is the group with the most under it.
    const byAt = new Map();
    for (const e of rec.build) {
      const k = [...e.at].sort().join(", ");
      if (!byAt.has(k)) byAt.set(k, []);
      byAt.get(k).push(e);
    }
    const n = rec.build.length;
    const blocks = [...byAt.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([, rows]) => unitTable(rows, true));
    out.push(`**${n} more ${n === 1 ? "unit" : "units"} once the building is up** — greyed out, with what each needs.\n\n`
      + maybeFold(`${n} ${n === 1 ? "unit" : "units"} this settlement raises once you build for them`,
        rec.build, blocks.join("\n\n")));
  }
  return out.join("\n\n");
}

const list = ONLY.length ? regions.filter((r) => ONLY.includes(r.region)) : regions;
fs.mkdirSync(path.join(OUT, "regions"), { recursive: true });
fs.mkdirSync(path.join(OUT, "settlements"), { recursive: true });

// Every declared trade good gets an icon, not only the ones a region page happens to show.
// This used to be restricted to the goods placed on the map, on the reasoning that the folder
// should not fill up with art nothing references — but gen-ris-trade-goods.js now writes a
// page per DECLARED good and puts the icon on each, so the four that are declared and placed
// nowhere (textiles, villages, shipwrecks, aqueduct) are referenced too. They are still all
// written from here rather than from both generators: one owner per file is what keeps the
// collision check in verify-ris-wiki.js meaningful.
const NEEDED_GOODS = new Set(res.tradeable);
for (const r of list) for (const tok of (MAP_RESOURCES.out.get(r.region) || new Map()).keys()) NEEDED_GOODS.add(tok);
const RES_ICONS = writeResourceIcons(NEEDED_GOODS);

// Every people any region names, from the ancestry field and from the `rel_<belief>_<tier>`
// tags, so a belief that appears only as a tag still gets its icon. Union of the two, because
// the two vocabularies are not identical: 1,180 of 1,311 regions name the same set both ways.
//
// Seeded with every belief descr_beliefs.txt DECLARES, not only the ones the map uses, for the
// same reason NEEDED_GOODS above is seeded with every declared trade good: gen-ris-belief-pages.js
// writes a page per declared belief and puts the pip on each, so the two the map never uses —
// `anatolian` and `greek`, the umbrella entries the finer-grained peoples sit under — are
// referenced too. They are still written from here, because one owner per output directory is
// what keeps the collision check in verify-ris-wiki.js meaningful.
const NEEDED_BELIEFS = new Set(Object.keys(BELIEFS));
for (const r of regions) {
  for (const e of r.ethnicities) NEEDED_BELIEFS.add(e.name);
  for (const t of r.tags) {
    const m = /^rel_([a-z_]+)_(\d)$/i.exec(String(t));
    if (m) NEEDED_BELIEFS.add(m[1].toLowerCase());
  }
}
const BELIEF_ICONS = writeBeliefIcons(NEEDED_BELIEFS);
const BELIEF_ICON_PX = 16;
const beliefIcon = (tok) => (BELIEF_ICONS.map[tok]
  ? `<img src="../${BELIEF_ICONS.map[tok]}" alt="" width="${BELIEF_ICON_PX}" height="${BELIEF_ICON_PX}" style="vertical-align:text-bottom"> `
  : "");
const goodIcon = (tok) => (RES_ICONS.map[tok] ? `<img src="../${RES_ICONS.map[tok]}" alt="" width="24">` : "");

// Each trade good has its own reference page (gen-ris-trade-goods.js writes one per good,
// named for the good's internal token). The Trade goods table listed the good as plain bold
// text, so a reader looking at what a region produces had no way through to what that good is
// worth, what it lets the settlement build, or which other regions have it — the same dead end
// the region tag values had before the tag reference existed.
const goodPages = (() => {
  try { return new Set(fs.readdirSync(path.join(OUT, "goods")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))); }
  catch { return new Set(); }
})();
let goodLinked = 0, goodUnlinked = new Set();
const goodRef = (tok) => {
  const label = `**${resName(tok) || humanise(tok)}**`;
  if (!goodPages.has(tok)) { if (goodPages.size) goodUnlinked.add(tok); return label; }
  goodLinked++;
  return `[${label}](../goods/${tok}.md)`;
};

let withMapGoods = 0, withOwner = 0, withBuildings = 0, withTrade = 0;
let withEthnicities = 0, withoutEthnicities = 0;
const unparseableEth = [];
const index = [];
const settlementIndex = [];
// A settlement page is named after its token, so two settlements sharing one would silently
// overwrite each other. Checked here rather than assumed: as RIS ships, all 1,311 tokens and
// all 1,311 display names are distinct, and the run fails loudly if that stops being true.
const settlementTokens = new Map();

for (const r of list) {
  const held = byRegion[r.region] || null;
  const rec = recruitableAt(r, held);
  if (held) withOwner++;
  if (held && (held.buildings || []).length) withBuildings++;
  const g = classify(r.tags, res);
  if (g.trade.length) withTrade++;

  // One row per attribute. These were nine consecutive "**Label:** value" lines, which every
  // markdown renderer folds into a single run-on paragraph — the labels only looked like
  // separate lines in the source file. A table also puts the values in a column you can scan
  // down when comparing regions.
  //
  // Two tables, not one. The first is the land: who lives here, how well it farms, what the
  // ground and the weather are, whether there is a harbour — things a reader looks at and
  // makes a decision about. The second is the gating tags: which areas of recruitment and
  // cultural homelands this region counts as, and the geography flags the building file tests
  // (`Asia minor, Has mine deposits, Qty coal 1`). Those decide real things, but only through
  // a condition somewhere else, and read as a token dump beside "Terrain: Mountains". They are
  // folded, with the count on the label, rather than dropped — every tag on the region is
  // still on the page.
  const rows = [], gated = [];
  const addRow = (label, arr, opts) => {
    if (!arr.length) return;
    const f = (opts && opts.link) ? tagRef : tagLabel;
    ((opts && opts.gated) ? gated : rows).push(`| ${label} | ${arr.map(f).join(", ")} |`);
  };
  const LINKED = { link: true };
  const GATE = { link: true, gated: true };
  const GATE_PLAIN = { gated: true };

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
  // Each people links to its own belief page — where else on the map it is, at what strength,
  // who follows it, and what the mod does with it. The label stays the display name the belief
  // file declares, so the link text and the page it lands on cannot read differently.
  const pName = (k) => ethName(k) || humanise(k);
  const peopleLine = eth.length
    ? eth.map((e) => `${beliefIcon(e.name)}${beliefRef(e.name, pName(e.name), "../")} ${e.pct}%`).join(", ") : null;
  const beliefLine = Object.keys(relTier).length
    ? Object.entries(relTier)
      .sort((a, b) => (b[1].tier || 0) - (a[1].tier || 0) || a[0].localeCompare(b[0]))
      .map(([k, rt]) => (rt.tier == null ? `\`${rt.tag}\`` : `${pName(k)} ${rt.tier}/4`))
      .join(", ")
    : null;

  // The land, not the city. Size, population, what is built and what can be raised have moved
  // to the settlement's own page: they are facts about a town, and a reader who searches for
  // "Aigion" was finding nothing at all before that page existed.
  const settleName = placeName(r.settlement);
  const settleHref = `../settlements/${encodeURIComponent(r.settlement)}.md`;
  const glance = [
    eth.length ? `**People:** ${eth.map((e) => `${beliefRef(e.name, ethName(e.name) || humanise(e.name), "../")} ${e.pct}%`).join(", ")}` : null,
    goodsLabel.length ? `**Trade goods:** ${goodsLabel.join(", ")}` : null,
  ].filter(Boolean).join(" · ");
  // The owner is named on both pages, and deliberately: it is the first thing asked of either,
  // and both come from this one expression in this one generator, so there is nothing here that
  // can drift out of step. Everything else about the town is stated on the town's page only.
  //
  // The culture comes with the owner rather than standing on its own, because a REGION has no
  // culture of its own — descr_regions declares none. What it has is an owner, and
  // descr_sm_factions gives that owner one. Saying it that way round is the difference between
  // a fact and an invention.
  const ownerCulture = held ? cultureRef(FACTION_CULTURE[String(held.faction).toLowerCase()], "../") : null;
  const ownerPhrase = held
    ? `${hasPage(held.faction) ? `[${facName(held.faction)}](../factions/${held.faction}.md)` : nonPlayableRef(held.faction)}${ownerCulture ? ` (${ownerCulture})` : ""}${held.capital ? " — **their capital**" : ""}`
    : null;

  if (peopleLine) rows.push(`| People | ${peopleLine} |`);
  // No Beliefs row. It restated the People row: measured across the generated pages, the set of
  // peoples and the set of beliefs are IDENTICAL on 1,180 of 1,311 regions, and on the 118 that
  // differ the difference is a minority people carrying no belief entry of its own — "Paeonian
  // 95%, Thracian 5%" against "Thracian 4/4". `beliefLine` is still computed, because the counts
  // below report on it and a region whose rel_ tags stop parsing should still be visible in the
  // run output rather than silently absent from a page nobody is looking at.
  addRow("Region resource tags", g.trade, GATE_PLAIN);
  // Fertility is the Farm## tag on a 1-14 scale, NOT descr_regions field 7 — RIS leaves that
  // field at a constant 5 for every region as a placeholder, so reporting it would give the
  // same answer 1,311 times. Provincia's region panel reads the tag for the same reason.
  if (g.farm.length) {
    const v = parseInt(String(g.farm[0]).replace(/\D+/g, ""), 10);
    // No note. "7 / 14" is the answer, and the link goes to the page that explains why RIS
    // cancels fertility's growth effect (FARM_NOTE above), which does not belong on 1,311 pages.
    const a = TAG_ANCHORS[String(g.farm[0]).toLowerCase()];
    const val = `**${v}** / 14`;
    if (a) tagLinked++;
    rows.push(`| Fertility | ${a ? `[${val}](../tags/${a.page}#${a.anchor})` : val} |`);
  }
  addRow("Terrain", g.terrain, LINKED);
  addRow("Climate", g.climate, LINKED);
  addRow("Irrigation", g.irrigation, LINKED);
  addRow("Port", g.port, LINKED);
  // Religion is NOT a row here any more: humanised, `rel_egyptian_4` printed as "Egyptian 4",
  // which reads as a percentage and is a strength tier. It has its own column in "Who lives
  // here", next to the real percentages, with RELIGION_NOTE explaining the scale. Nothing is
  // dropped — every rel_ tag on the region appears there, including any that does not match
  // the `rel_<belief>_<tier>` shape.
  addRow("Hazards and river trade", g.hazard, LINKED);
  addRow("Recruitment zones", g.recruitment, GATE);
  addRow("Specialty recruitment", g.specialty, GATE);
  addRow("Cultural homeland", g.culture, GATE);
  addRow("Geography and gating", g.geography, GATE_PLAIN);
  addRow("Other tags", g.other, GATE_PLAIN);

  const body = `# ${placeName(r.region)}

[← all regions](../regions.md) · [wiki index](../README.md)

**Its settlement is [${settleName}](${settleHref})**${ownerPhrase ? `, held at the campaign start by ${ownerPhrase}` : ""}. That page has the town —
its size, its population, what is built there and what it can raise. This one is the land.

${[glance, held ? null : `This region begins **independent**. If it revolts, the rebels are ${r.rebels}.`].filter(Boolean).join("\n\n")}

## Trade goods

${goods.length
  ? `| | Trade good | Amount |\n|:-:|---|---:|\n${goods.map(([type, n]) => `| ${goodIcon(type)} | ${goodRef(type)} | ${n} |`).join("\n")}`
  : "_No trade goods are placed inside this region._"}

${goods.length ? "See the [trade goods reference](../trade-goods.md) for what each is worth and what it unlocks." : ""}

## Resources and character

${rows.length ? `| | |\n|---|---|\n${rows.join("\n")}` : "_This region carries no tags._"}
${gated.length ? `
<details>
<summary>Which recruitment zones and homelands this region counts as (${gated.length})</summary>

These are the tags the building and recruitment files test on this region. Each one is a
condition somewhere else — a unit that can only be raised in these provinces, a building level
a homeland unlocks, a mineral the mines chain needs.

| | |
|---|---|
${gated.join("\n")}

</details>
` : ""}
`;

  fs.writeFileSync(path.join(OUT, "regions", `${r.region}.md`), body, "utf8");

  // ── the settlement's own page ──────────────────────────────────────────────
  // One per settlement, 1:1 with a region, and NOT a copy of the region page: everything here
  // is about the town and has been moved off the region page rather than duplicated. Written
  // from here because this generator is the one that already holds descr_strat's settlement
  // blocks and the region's recruitment evaluation; a second generator reading the same file
  // would be a second thing to keep in step.
  const builtTable = held && (held.buildings || []).length
    ? `| | Building chain | Level |\n|:-:|---|---|\n${held.buildings.map((b) => `| ${(() => { const ic = iconFor(held.faction, b.level); return ic ? `<img src="../${ic}" alt="" width="32">` : ""; })()} | ${chainLink(b.chain)} | ${levelLink(b)} |`).join("\n")}`
    : held ? "_Nothing is built here at the campaign start._"
      : "_No faction holds this settlement at the campaign start, so the campaign file records nothing built in it._";
  const townGlance = [
    held ? `**Size:** ${sizeRef(held.level, "../") || "_not determined_"}` : null,
    held && held.pop != null ? `**Population:** ${held.pop.toLocaleString("en-US")}` : null,
    held && (held.buildings || []).length ? `**Buildings:** ${held.buildings.length}` : null,
  ].filter(Boolean).join(" · ");
  const townBody = `# ${settleName}

[← all settlements](../settlements.md) · [all regions](../regions.md) · [wiki index](../README.md)

The settlement of the region of **[${placeName(r.region)}](../regions/${encodeURIComponent(r.region)}.md)**${ownerPhrase ? `, held at the campaign start by ${ownerPhrase}` : ""}.
${townGlance ? `\n${townGlance}\n` : ""}${held ? "" : `\nNo faction holds it at the campaign start. If the region revolts, the rebels are ${r.rebels}.\n`}
## What is already built

${builtTable}

## What can be recruited here

${recruitSection(rec, held)}

## The land around it

Terrain, climate, fertility, water, port, the trade goods placed inside the borders, and the
recruitment zones and homeland this ground counts as, are all on
**[${placeName(r.region)}](../regions/${encodeURIComponent(r.region)}.md)** — stated there once, so the two pages
cannot disagree.
`;
  if (settlementTokens.has(r.settlement)) {
    console.error(`SETTLEMENT NAME COLLISION: "${r.settlement}" is the settlement of both ${settlementTokens.get(r.settlement)} and ${r.region} — one page would overwrite the other`);
    process.exitCode = 2;
  }
  settlementTokens.set(r.settlement, r.region);
  fs.writeFileSync(path.join(OUT, "settlements", `${r.settlement}.md`), townBody, "utf8");
  settlementIndex.push({
    settlement: r.settlement, name: settleName, region: r.region, regionName: placeName(r.region),
    level: held ? String(held.level || "").toLowerCase() : null,
    pop: held && held.pop != null ? held.pop : null,
    owner: held ? facName(held.faction) : null, ownerTok: held ? held.faction : null,
    capital: !!(held && held.capital), builds: held ? (held.buildings || []).length : 0,
  });

  index.push({ region: r.region, regionName: placeName(r.region), settlement: r.settlement, settlementName: settleName, owner: held ? facName(held.faction) : null, ownerTok: held ? held.faction : null, trade: goods.length, builds: held ? (held.buildings || []).length : 0 });
}

// Every cell in this table now links: the settlement column was dead text, which on the index
// of 1,311 places is the column a reader is most likely to click. The two numeric headings are
// short words on purpose — a numeric column is as wide as its heading, and "Trade goods" and
// "Buildings" were spending 20 characters of a table that has to fit beside its neighbour
// before the viewer will lay it two-up. Neither number is dropped: measured over the 1,311
// rows, goods run 0–8 across 9 distinct values and buildings 0–17 across 18, so both vary,
// unlike the faction index's regional-unit column that ran 424–443 and was a constant.
index.sort((a, b) => a.regionName.localeCompare(b.regionName));
const ownerCell = (e) => (e.owner
  ? (hasPage(e.ownerTok) ? `[${e.owner}](factions/${e.ownerTok}.md)` : `[${npName(e.ownerTok)}](factions/non-playable.md)`)
  : "_independent_");
const idx = `# All regions

[← wiki index](README.md) · [all settlements](settlements.md) · [region tag reference](tags.md) · [cultures](cultures.md) · [beliefs](religions.md)

${index.length.toLocaleString("en-US")} regions, one settlement each. ${withOwner.toLocaleString("en-US")} are held by a faction at the campaign
start; the rest begin independent. A region is the land — terrain, fertility, trade goods; its
settlement is the town, on its own page.

| Region | Settlement | Held by | Goods | Buildings |
|---|---|---|---:|---:|
${index.map((e) => `| [${e.regionName}](regions/${encodeURIComponent(e.region)}.md) | [${e.settlementName}](settlements/${encodeURIComponent(e.settlement)}.md) | ${ownerCell(e)} | ${e.trade} | ${e.builds} |`).join("\n")}
`;
fs.writeFileSync(path.join(OUT, "regions.md"), idx, "utf8");

// ── the settlement index ─────────────────────────────────────────────────────
settlementIndex.sort((a, b) => a.name.localeCompare(b.name));
const capitals = settlementIndex.filter((s) => s.capital).length;
const sIdx = `# All settlements

[← wiki index](README.md) · [all regions](regions.md) · [settlement sizes](sizes.md) · [cultures](cultures.md) · [beliefs](religions.md)

${settlementIndex.length.toLocaleString("en-US")} settlements, one per region. ${capitals} of them are a faction's capital.
Search finds a city by name here; the region it sits in is the land around it, with the terrain,
fertility and trade goods.

Size is a rung on a ladder of ${Object.keys(SIZE_INDEX).length || 6}, and it decides what a settlement can build and raise —
each one links to [what that size does](sizes.md).

| Settlement | Region | Held by | Size | Population | Buildings |
|---|---|---|---|---:|---:|
${settlementIndex.map((s) => `| [${s.name}](settlements/${encodeURIComponent(s.settlement)}.md)${s.capital ? " ★" : ""} | [${s.regionName}](regions/${encodeURIComponent(s.region)}.md) | ${s.owner ? (hasPage(s.ownerTok) ? `[${s.owner}](factions/${s.ownerTok}.md)` : `[${npName(s.ownerTok)}](factions/non-playable.md)`) : "_independent_"} | ${sizeRef(s.level, "") || "—"} | ${s.pop != null ? s.pop.toLocaleString("en-US") : "—"} | ${s.builds} |`).join("\n")}

★ marks a faction capital.
`;
fs.writeFileSync(path.join(OUT, "settlements.md"), sIdx, "utf8");

console.log(`${list.length} region pages written`);
console.log(`  settlement pages written:   ${settlementIndex.length} (+ settlements.md) · distinct tokens ${settlementTokens.size}${settlementTokens.size === settlementIndex.length ? " — no collision" : " — COLLISION, a page was overwritten"}`);
{
  const names = new Set(settlementIndex.map((s) => s.name.toLowerCase()));
  console.log(`  distinct settlement display names: ${names.size} of ${settlementIndex.length}${names.size === settlementIndex.length ? " — no two towns share a title" : " — TWO TOWNS SHARE A TITLE, search cannot tell them apart"}`);
}
console.log(`  place names from text/imperial_campaign_regions_and_settlement_names.txt: ${placeNameVia.declared.toLocaleString("en-US")} lookups resolved, ${placeNameVia.fallback.size} token${placeNameVia.fallback.size === 1 ? "" : "s"} with no entry${placeNameVia.fallback.size ? ` (${[...placeNameVia.fallback].slice(0, 10).join(", ")})` : ""}`);
console.log(`  non-playable owners named and linked: ${npCells.toLocaleString("en-US")} cells · from text/expanded_bi.txt: ${[...npNameVia.declared].join(", ") || "none"}${npNameVia.fallback.size ? ` · NO DISPLAY NAME, token shown: ${[...npNameVia.fallback].join(", ")}` : ""}`);
console.log(`  held by a faction at start: ${withOwner}`);
console.log(`  with something built:       ${withBuildings}`);
console.log(`  map resource placements: ${MAP_RESOURCES.placed.toLocaleString("en-US")} placed, ${MAP_RESOURCES.resolved.toLocaleString("en-US")} mapped to a region`);
console.log(`  cross-check vs the file's own settlement comment: ${MAP_RESOURCES.agreed.toLocaleString("en-US")}/${MAP_RESOURCES.checked.toLocaleString("en-US")} agree (${MAP_RESOURCES.checked?Math.round(MAP_RESOURCES.agreed/MAP_RESOURCES.checked*100):0}%)`);
console.log(`  slaves: ${slaveBaselineOnly.toLocaleString("en-US")} regions have the baseline only (hidden), ${slaveSurplus.toLocaleString("en-US")} have a surplus (shown), ${slaveMissing.toLocaleString("en-US")} have none at all`);
console.log(`  regions with trade goods:  ${withMapGoods.toLocaleString("en-US")}`);
console.log(`  with a trade resource:      ${withTrade}`);
console.log(`  resource vocabulary read:   ${res.tradeable.size} tradeable, ${res.hidden.size} hidden`);
console.log(`  resource names (distinct tokens): ${resNameVia.declared.size} via the key the resource declares, ${resNameVia.convention.size} via smt_resource_<token>, ${resNameVia.none.size} declared resources with no text entry${resNameVia.none.size ? ` (${[...resNameVia.none].join(", ")})` : ""}`);

console.log(`\nrecruitment at the campaign start (export_descr_buildings, evaluated against turn-0 state):`);
console.log(`  settlements evaluated:      ${recruitStats.evaluated.toLocaleString("en-US")}`);
console.log(`  with no military building:  ${recruitStats.noMilitary.toLocaleString("en-US")} (no armoury and no garrison, so nothing to recruit from)`);
console.log(`  with nothing available now: ${recruitStats.zeroNow.toLocaleString("en-US")}  <- should track the line above; a gap means the evaluator is wrong, not the mod`);
console.log(`  unit rows available now:    ${recruitStats.now.toLocaleString("en-US")} (${(recruitStats.now / Math.max(1, recruitStats.evaluated)).toFixed(1)} per settlement)`);
console.log(`  unit rows still conditional:${recruitStats.conditional.toLocaleString("en-US")}, of which ${recruitStats.ambiguous.toLocaleString("en-US")} evaluations hit an unbracketed and/or`);
console.log(`  settlement ladder: ${SETTLE.order.join(" < ")} (${SETTLE.ladders} cultures declare one, ${SETTLE.disagree} disagree)`);
console.log(`  reforms ruled out at turn 0: ${[...EVENT_INACTIVE.values()].filter((v) => v === "inactive").length}/${EVENT_INACTIVE.size}; the rest stay conditional and are named on the page`);
console.log(`  undecided clause kinds: ${[...recruitStats.undecided].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} x${n.toLocaleString("en-US")}`).join(", ") || "none"}`);
console.log(`  tag reference links: ${tagLinked.toLocaleString("en-US")} values linked${tagUnlinked.size ? `, ${tagUnlinked.size} tokens with no reference entry (${[...tagUnlinked].slice(0, 6).join(", ")})` : ""}`);
console.log(`  trade good links: ${goodLinked.toLocaleString("en-US")} table cells linked to goods/ (${goodPages.size} good pages found)${goodUnlinked.size ? `, ${goodUnlinked.size} goods with no page (${[...goodUnlinked].join(", ")})` : ""}${goodPages.size ? "" : "  <- run gen-ris-trade-goods.js, then this generator again"}`);

console.log(`\nancestry (descr_regions field 7, "<people> <pct>" pairs):`);
console.log(`  parsed:     ${withEthnicities.toLocaleString("en-US")} regions`);
console.log(`  unparseable or absent: ${withoutEthnicities.toLocaleString("en-US")}${unparseableEth.length ? ` — e.g. ${unparseableEth.join("; ")}` : ""}`);
console.log(`  people display names (distinct tokens): ${ethNameVia.declared.size} via the key descr_beliefs.txt declares, ${ethNameVia.convention.size} via the <TOKEN>_LABEL convention, ${ethNameVia.none.size} with no entry (token humanised)${ethNameVia.none.size ? ` — ${[...ethNameVia.none].join(", ")}` : ""}`);

console.log(`\nbelief icons -> ${path.join(OUT, "belief-icons")} (source pips at 1/${BELIEF_ICON_SCALE}, shown at ${BELIEF_ICON_PX}px):`);
console.log(`  descr_beliefs.txt declares:  ${Object.keys(BELIEFS).length} beliefs, ${Object.values(BELIEFS).filter((b) => b.icon).length} with a religion icon, ${Object.values(BELIEFS).filter((b) => b.nameKey).length} with a name key`);
{
  const used = new Set();
  for (const r of regions) {
    for (const e of r.ethnicities) used.add(e.name);
    for (const t of r.tags) { const m = /^rel_([a-z_]+)_(\d)$/i.exec(String(t)); if (m) used.add(m[1].toLowerCase()); }
  }
  console.log(`  pips written for: ${NEEDED_BELIEFS.size} (every declared belief, so the belief pages all have one)`);
  console.log(`  of those, peoples the map actually uses: ${used.size} (union of the ancestry field and the rel_ tags)`);
}
{
  const undeclared = [...NEEDED_BELIEFS].filter((t) => !BELIEFS[t]);
  const unused = Object.keys(BELIEFS).filter((t) => !NEEDED_BELIEFS.has(t));
  console.log(`    used but not declared: ${undeclared.length}${undeclared.length ? ` (${undeclared.join(", ")})` : ""}  <- these are the ones that would show no icon`);
  console.log(`    declared but on no region: ${unused.length}${unused.length ? ` (${unused.join(", ")})` : ""}`);
}
console.log(`  written:                     ${BELIEF_ICONS.written} (${(BELIEF_ICONS.bytes / 1024).toFixed(0)} KB, ${BELIEF_ICONS.w}x${BELIEF_ICONS.h} each)`);
console.log(`  no "religion icon" declared: ${BELIEF_ICONS.noDeclaration.length}${BELIEF_ICONS.noDeclaration.length ? ` (${BELIEF_ICONS.noDeclaration.join(", ")})` : ""}`);
console.log(`  declared file not on disk:   ${BELIEF_ICONS.fileMissing.length}${BELIEF_ICONS.fileMissing.length ? ` (${BELIEF_ICONS.fileMissing.join(", ")})` : ""}`);
console.log(`  threw while decoding:        ${BELIEF_ICONS.failed.length}${BELIEF_ICONS.failed.length ? ` (${BELIEF_ICONS.failed.join(", ")})` : ""}  <- a zero here means nothing threw, not that the art is correct; open one and look`);

console.log(`\nbelief and culture pages:`);
console.log(`  peoples linked into religions/: ${beliefLinked.toLocaleString("en-US")} cells (${Object.keys(BELIEF_INDEX).length} beliefs in religions/index.json)${beliefUnlinked.size ? `, ${beliefUnlinked.size} with no entry (${[...beliefUnlinked].join(", ")})` : ""}${Object.keys(BELIEF_INDEX).length ? "" : "  <- run gen-ris-belief-pages.js, then this generator again"}`);
console.log(`  owners' cultures linked into cultures/: ${cultureLinked.toLocaleString("en-US")} cells (${Object.keys(CULTURE_INDEX).length} cultures in cultures/index.json)${cultureUnlinked.size ? `, ${cultureUnlinked.size} with no entry (${[...cultureUnlinked].join(", ")})` : ""}${Object.keys(CULTURE_INDEX).length ? "" : "  <- run gen-ris-culture-pages.js, then this generator again"}`);

console.log(`\nsettlement sizes: ${sizeLinked.toLocaleString("en-US")} Size values linked into sizes/ (${Object.keys(SIZE_INDEX).length} sizes in sizes/index.json)${sizeUnlinked.size ? `, ${sizeUnlinked.size} with no entry (${[...sizeUnlinked].join(", ")})` : ""}${Object.keys(SIZE_INDEX).length ? "" : "  <- run gen-ris-settlement-sizes.js, then this generator again"}`);

console.log(`\ntrade-good icons -> ${path.join(OUT, "resource-icons")} (1/${ICON_SCALE} of the source art):`);
console.log(`  goods referenced by a page: ${NEEDED_GOODS.size}`);
console.log(`  written:                    ${RES_ICONS.written} (${(RES_ICONS.bytes / 1024).toFixed(0)} KB)`);
console.log(`  no "icon" declared:         ${RES_ICONS.noDeclaration.length}${RES_ICONS.noDeclaration.length ? ` (${RES_ICONS.noDeclaration.join(", ")})` : ""}`);
console.log(`  declared file not on disk:  ${RES_ICONS.fileMissing.length}${RES_ICONS.fileMissing.length ? ` (${RES_ICONS.fileMissing.join(", ")})` : ""}`);
// "failed" means the decoder threw or returned nothing. It does NOT mean the images are
// right: a 32bpp source read as 24bpp produced correctly-sized colour-stripe garbage without
// throwing once, across 1,132 files. Only opening one shows that.
console.log(`  threw while decoding:       ${RES_ICONS.failed.length}${RES_ICONS.failed.length ? ` (${RES_ICONS.failed.join(", ")})` : ""}  <- a zero here means nothing threw, not that the art is correct; open one and look`);
