// save-budget-full.js — pointer-registry budget using the FULL entity schema
// from the dev log image (Pointer registry closing, entity counts:):
//
//   factions, settlements, forts, ports, watchtowers, characters, armies,
//   units, resources, roads, sieges, character records, buildings, cameras,
//   superfactions
//
// Each entity consumes ONE pointer-registry slot. Hard cap = 65,536. Once
// the engine pushes past that, the save corrupts.
//
// What we count vs estimate (per current parser coverage):
//   COUNTED from save (cover.js + sub-parsers):
//     characters (live), units, factions, settlements, building chains,
//     character records (dead pool), army records (EF-headers), sieges
//   ESTIMATED from dev ratios (no save parser yet for these):
//     forts, ports, watchtowers, armies (full count, EF-header subset only),
//     resources, roads, cameras, superfactions
//
// Usage: node scripts/save-budget-full.js <save.sav>

"use strict";
const fs = require("fs");
const path = require("path");

const { findUnitRecords } = require("../src/unitParser.js");
// 2026-05-26: structural parser misses ~660 mercenary-pool unit entries
// per save (`merc <name>` variants live in their own section). Read EDU
// once, scan the buffer for every type-name as a pstr16, and use the
// hit-count when it exceeds the structural one.
const EDU_PATH = "C:/RIS/RIS/data/export_descr_unit.txt";
function countUnitsByEduNames(buf) {
  try {
    const edu = fs.readFileSync(EDU_PATH, "utf8");
    const names = [];
    for (const line of edu.split(/\r?\n/)) {
      const m = line.match(/^type\s+(.+?)\s*$/);
      if (m) names.push(m[1].trim());
    }
    let total = 0;
    for (const name of names) {
      const lenIncNull = name.length + 1;
      if (lenIncNull < 4 || lenIncNull > 50) continue;
      const probe = Buffer.alloc(2 + lenIncNull);
      probe.writeUInt16LE(lenIncNull, 0);
      probe.write(name, 2, "ascii");
      probe[probe.length - 1] = 0;
      let p = 0;
      while ((p = buf.indexOf(probe, p)) >= 0) { total++; p += 2; }
    }
    return total;
  } catch { return null; }
}
const { findFactionRecords } = require("../src/factionRecordParser.js");
const { findAllSettlementMarkers, scanChainsBetween } = require("../src/buildingParser.js");
const { findCharacterRecords } = require("../src/characterParser.js");
const { countEngineCharacters } = require("../src/saveCrackerExtras.js");
const { countDeadPoolRecords } = require("../src/characterParser.js");
const { countMapEntities } = require("../src/mapEntityParser.js");

const MOD_DATA_DIR = "C:/RIS/RIS/data";

// Count `resource <type>, <amount>, <x>, <y>` lines in the active campaign's
// descr_strat. Resources are tile-placements that don't change during a
// campaign (cities can be razed but the resource tile remains and re-enters
// the registry when re-conquered). descr_strat is the authoritative source.
// 2026-05-27 cracking session refuted the post-grid 267-stride array as the
// resource table; descr_strat counting is the most reliable proxy until a
// dedicated save-buffer parser surfaces.
function countResourcesFromDescrStrat() {
  const candidates = [
    path.join(MOD_DATA_DIR, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(MOD_DATA_DIR, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(MOD_DATA_DIR, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    return (text.match(/^resource\s+/gm) || []).length;
  }
  return null;
}

// Dev-log entity ratios (sum = 65,563 ≈ 100 % of pointer registry at the moment of corruption).
const DEV = {
  factions: 112, settlements: 1831, forts: 0, ports: 1276,
  watchtowers: 363, characters: 2197, armies: 2581, units: 12768,
  resources: 2926, roads: 3957, sieges: 26, characterRecords: 12692,
  buildings: 24834, cameras: 0, superfactions: 0,
};
const DEV_TOTAL = Object.values(DEV).reduce((a, b) => a + b, 0);

const CAP = 65_536;

function loadNameLookup(modDir) {
  try {
    const p = path.join(modDir, "text", "names.txt");
    const raw = fs.readFileSync(p, "utf16le");
    const out = new Map();
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/\{([^}]+)\}\s*(.*)/);
      if (m) out.set(m[1].toLowerCase(), m[2].trim());
    }
    return out;
  } catch { return null; }
}

function loadTraitNames(modDir) {
  try {
    const p = path.join(modDir, "export_descr_character_traits.txt");
    const raw = fs.readFileSync(p, "utf8");
    const names = new Set();
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^Trait\s+(\w+)/);
      if (m) names.add(m[1]);
    }
    return names;
  } catch { return null; }
}

const SAVE = process.argv[2];
if (!SAVE || !fs.existsSync(SAVE)) { console.error("usage: node save-budget-full.js <save.sav>"); process.exit(1); }

const buf = fs.readFileSync(SAVE);
console.log(`save: ${path.basename(SAVE)}`);
console.log(`size: ${(buf.length / (1024 * 1024)).toFixed(1)} MB`);
console.log();

// 1. Counts we can pull straight from existing parsers.
const live = countEngineCharacters(buf);
const dead = countDeadPoolRecords(buf);
const unitRecs = findUnitRecords(buf);
const unitsStructural = unitRecs.length;
const unitsEdu = countUnitsByEduNames(buf);
const units = (unitsEdu != null && unitsEdu > unitsStructural) ? unitsEdu : unitsStructural;
console.log(`unit-count cross-check: structural=${unitsStructural}, EDU-pstr16=${unitsEdu ?? "n/a"}, using=${units}`);
// Army count: distinct commander UUIDs + distinct fleet UUIDs + per-region
// garrisons (units with no commanderUuid grouped by region). This very
// closely matches the dev image's "armies" bucket (1270+55+1196 = 2521 vs
// dev 2581 at turn ~500). Replaces the previous dev-ratio estimate.
const cmdSet = new Set(), fleetSet = new Set(), regionGarSet = new Set();
for (const r of unitRecs) {
  if (r.commanderUuid != null) cmdSet.add(r.commanderUuid);
  if (r.fleetUuid) fleetSet.add(r.fleetUuid);
  if (r.commanderUuid == null && r.region) regionGarSet.add(r.region);
}
const armies = cmdSet.size + fleetSet.size + regionGarSet.size;
console.log(`army-count cross-check: commanded=${cmdSet.size}, naval=${fleetSet.size}, region-garrisons=${regionGarSet.size}, total=${armies}`);
const factions = findFactionRecords(buf).length;
const settsAll = findAllSettlementMarkers(buf);
const setts = settsAll.filter(s => s.offset >= 0xf85f00 && s.offset < 0x1f10c72);
let buildings = 0;
for (let i = 0; i < setts.length; i++) {
  const prevEnd = i === 0 ? 0xf85f00 : setts[i - 1].blockEnd;
  buildings += scanChainsBetween(buf, prevEnd, setts[i].offset, null, null).length;
}

// 2. Estimate the categories we don't parse yet, by applying the dev ratio
//    against a known-good anchor in this save. Use `buildings` as the anchor
//    (it's the biggest single category, so the % error of dividing by it is
//    smallest). Scale every dev value: est_X = dev_X / dev_buildings * X.
const anchor = buildings || units || 1;
const anchorBase = DEV.buildings || DEV.units;
const scale = anchor / anchorBase;

function est(key) {
  return Math.round((DEV[key] || 0) * scale);
}

// 2b. Map-entity counts from chain scans + 267-stride aux array.
// roads & ports are counted from settlement-detail building chains.
// watchtowers is best-effort (post-grid 267-stride non-template records);
// returns null on saves where the array isn't present yet, then we estimate.
const mapEnts = countMapEntities(buf);
const watchtowersCounted = mapEnts.watchtowers;
console.log(`map-entity counts: roads=${mapEnts.roads} (hinterland_roads chains), ports=${mapEnts.ports} (port_buildings=${mapEnts.portsBuildings} + river_port=${mapEnts.portsRiver}), watchtowers=${watchtowersCounted ?? "n/a (array absent — early game)"}`);

// 3. Build final table. Known counts override estimates.
const counts = {
  factions,                       // counted
  settlements: setts.length,      // counted
  forts: est("forts"),            // estimated (dev = 0)
  ports: mapEnts.ports,           // counted (port_buildings + river_port chains)
  watchtowers: watchtowersCounted ?? est("watchtowers"),  // probable-counted or estimated
  characters: live,               // counted
  armies,                         // counted (commanded + naval + region-garrisons)
  units,                          // counted
  resources: 0,                   // set below from descr_strat count
  roads: mapEnts.roads,           // counted (hinterland_roads chains)
  sieges: 0,                      // counted (set below)
  characterRecords: dead,         // counted
  buildings,                      // counted
  cameras: 0,
  superfactions: 0,
};
// 2026-05-27: watchtowers now from the canonical 40-byte-stride table
// (walked count == declared u16 header for all reference saves). No longer
// a heuristic — flip "(counted-probable)" to "(counted)".
const watchtowersSource = watchtowersCounted != null ? "(counted)" : "(est)";
// Siege block at fixed offset (cover.js claims 0x152f529); presence ≈ 1 siege.
// TODO: scan all sieges; for now this is a coarse 0/1.
counts.sieges = (buf.length > 0x152f529 + 73) ? 1 : 0;

// 2026-05-27: resources count from descr_strat tile placements (5,548 for
// RIS imperial). Resources are static — they don't get created/destroyed by
// normal play, just enter/leave the registry when settlements change hands.
// Best approximation until a save-buffer parser surfaces.
const resourcesCounted = countResourcesFromDescrStrat();
counts.resources = resourcesCounted ?? est("resources");
const resourcesSource = resourcesCounted != null ? "(counted-descr-strat)" : "(est)";

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const headroom = CAP - total;
const pct = (100 * total / CAP).toFixed(1);

// Print breakdown sorted by share of pool.
// ports, roads are now counted from chain scans.
// watchtowers is "(counted-probable)" if the post-grid array exists, else "(est)".
const COUNTED = new Set(["factions","settlements","characters","armies","units","sieges","characterRecords","buildings","ports","roads"]);
const rows = Object.entries(counts).map(([k, v]) => {
  let source;
  if (k === "watchtowers") source = watchtowersSource;
  else if (k === "resources") source = resourcesSource;
  else if (COUNTED.has(k)) source = "(counted)";
  else source = "(est)";
  return { key: k, count: v, share: (100 * v / CAP).toFixed(2), source };
});
rows.sort((a, b) => b.count - a.count);
console.log("entity counts (sorted by share of pointer registry):");
console.log("  " + "category".padEnd(20) + "count".padStart(8) + "    share   source");
console.log("  " + "-".repeat(56));
for (const r of rows) {
  if (r.count === 0) continue;
  console.log("  " + r.key.padEnd(20) + r.count.toString().padStart(8) + "    " + r.share.padStart(4) + "%   " + r.source);
}
console.log("  " + "-".repeat(56));
console.log("  " + "TOTAL".padEnd(20) + total.toString().padStart(8) + "    " + pct.padStart(4) + "%");
console.log();
console.log(`pointer-registry cap:       ${CAP.toLocaleString()}`);
console.log(`remaining headroom:         ${headroom.toLocaleString()}`);

const tier = total / CAP >= 0.95 ? "RED (corruption imminent)"
           : total / CAP >= 0.85 ? "ORANGE (near limit, save risk)"
           : total / CAP >= 0.70 ? "YELLOW (watch closely)"
           : "GREEN (healthy)";
console.log(`tier:                       ${tier}`);
console.log();
console.log(`dev reference total at corruption: ${DEV_TOTAL.toLocaleString()} (${(100*DEV_TOTAL/CAP).toFixed(1)}% of cap)`);
console.log(`scaling anchor: buildings ${anchor} vs dev ${anchorBase} → scale ${scale.toFixed(3)}`);
