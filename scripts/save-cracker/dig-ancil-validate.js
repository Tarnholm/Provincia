// dig-ancil-validate.js — research/diagnostic ONLY (no app code changes)
//
// GOAL: validate the full ancillary mapping for character records in
// save_macedon t0.sav (RIS). Three deliverables:
//   (1) Confirm per-character ancillary storage (id list, slot layout).
//   (2) Validate id->NAME rule = 0-based index into the declaration order
//       of `Ancillary <name>` lines in export_descr_ancillaries.txt.
//   (3) Report slot count + concrete offsets + match evidence vs descr_strat
//       ground truth (bridged by tile x,y).
//
// Ground truth source: descr_strat.txt `ancillaries <a,b,c>` lines for the
// antigonid (Macedon) faction. We bridge save record -> descr_strat entry
// by tile (x,y), which v1 parser attaches via buildPositionIndex.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = "save_macedon t0.sav";
const STRAT = path.join(MOD, "world/maps/campaign/imperial_campaign/descr_strat.txt");

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}
// id -> name (0-based, declaration order). This is the rule under test.
const ancNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_ancillaries.txt"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^Ancillary\s+(\S+)/); if (m) ancNames.push(m[1]);
}
const nameToId = new Map();
ancNames.forEach((n, i) => nameToId.set(n, i));
console.log(`Loaded ${ancNames.length} ancillary names. (e.g. id0=${ancNames[0]}, id1=${ancNames[1]})`);

// ---- Ground truth from descr_strat: tile(x,y) -> {name, ancList} ----
const stratLines = fs.readFileSync(STRAT, "utf8").split(/\r?\n/);
const gtByTile = new Map(); // "x,y" -> { charName, ancs:[names] }
let curChar = null;
for (const raw of stratLines) {
  const line = raw.trim();
  if (line.startsWith(";")) continue; // skip commented lines
  const cm = raw.match(/^character,\s*(?:sub_faction\s+\S+,\s*)?([A-Za-z_]+),.*?\bx\s+(\d+),\s*y\s+(\d+)/);
  if (cm) {
    curChar = { name: cm[1], x: +cm[2], y: +cm[3], ancs: [] };
    gtByTile.set(`${cm[2]},${cm[3]}`, curChar);
    continue;
  }
  const am = raw.match(/^\s*ancillaries\s+(.+)$/);
  if (am && curChar) {
    curChar.ancs = am[1].split(",").map(s => s.trim()).filter(Boolean);
  }
}
const gtWithAncs = [...gtByTile.values()].filter(c => c.ancs.length);
console.log(`descr_strat: ${gtByTile.size} characters parsed, ${gtWithAncs.length} have ancillaries.`);

// ---- Parse the save ----
const buf = fs.readFileSync(path.join(SAVES, SAVE));
console.log(`\nSave: ${SAVE} (${(buf.length/1048576).toFixed(1)} MB)`);
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`Parsed ${recs.length} character records.\n`);

// Index parsed records by tile.
const recByTile = new Map();
for (const r of recs) {
  if (r.tileX != null && r.tileY != null) recByTile.set(`${r.tileX},${r.tileY}`, r);
}

// ---- Cross-validate ancillary names vs ground truth ----
let gtTotal = 0, matched = 0, missing = 0, mismatch = 0, noRec = 0;
const mismatches = [];
console.log("=== Ground-truth ancillary validation (bridged by tile) ===");
for (const gt of gtWithAncs) {
  gtTotal += gt.ancs.length;
  const r = recByTile.get(`${gt.x},${gt.y}`);
  if (!r) {
    noRec++;
    console.log(`  [no save record at tile ${gt.x},${gt.y}] ${gt.name}: expected ${gt.ancs.join(", ")}`);
    continue;
  }
  const parsedNames = (r.ancillaries || []).map(a => ancNames[a.id] || `#${a.id}`);
  const parsedIds = (r.ancillaries || []).map(a => a.id);
  // Compare as sets (order may differ).
  const exp = new Set(gt.ancs);
  const got = new Set(parsedNames);
  const allHit = gt.ancs.every(n => got.has(n));
  const exact = exp.size === got.size && allHit;
  const tag = exact ? "OK   " : (allHit ? "OK*  " : "FAIL ");
  if (exact || allHit) matched += gt.ancs.length;
  else { mismatch++; mismatches.push({ gt, parsedNames, parsedIds }); }
  console.log(`  ${tag} ${gt.name.padEnd(16)} @${gt.x},${gt.y}  exp=[${gt.ancs.join(", ")}]  got=[${parsedNames.join(", ")}] ids=[${parsedIds.join(",")}]`);
}
console.log(`\nSummary: gt_chars=${gtWithAncs.length} gt_ancs=${gtTotal} matched_ancs=${matched} mismatched_chars=${mismatch} no_record=${noRec}`);

// ---- Expected ids for the known cases (sanity on the index rule) ----
console.log("\n=== Expected id for each ground-truth ancillary name ===");
const seen = new Set();
for (const gt of gtWithAncs) for (const a of gt.ancs) {
  if (seen.has(a)) continue; seen.add(a);
  console.log(`  ${a.padEnd(22)} -> id ${nameToId.has(a) ? nameToId.get(a) : "(NOT IN FILE)"}`);
}
