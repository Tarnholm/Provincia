// dig-bloodline-baseline.js
//
// Establish ground truth on faction LEADER / HEIR detection and family edges
// using the existing v1 character parser (characterParser.js). The parser
// already flags isLeader / isHeir via the Factionleader / Factionheir TRAITS,
// and exposes fatherUuid (+46), childUuids (+54..+66), spouseUuid (+50).
//
// This run answers:
//   1. How many leaders / heirs does the trait-based detection find per save?
//   2. Are leaders the oldest / highest-influence family member at T0?
//   3. Do father/child UUID edges resolve to real characters in the same save?
//
// Pure read; reports only.

const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

// Load the mod's name + trait lookup tables from the RIS mod data dir, mirroring
// main.js loadModCharacterData (descr_names_lookup.txt + export_descr_character_traits.txt).
const MOD_DIRS = [
  "C:\\RIS\\RIS\\data",
  "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\Mods\\My Mods\\RIS beta\\data",
];
function loadLookups() {
  let modDir = null;
  for (const d of MOD_DIRS) if (fs.existsSync(path.join(d, "descr_names_lookup.txt"))) { modDir = d; break; }
  if (!modDir) return { nameLookup: null, traitNames: null };
  const nameLookup = fs.readFileSync(path.join(modDir, "descr_names_lookup.txt"), "utf8")
    .split(/\r?\n/).map(s => s.trim());
  const traitNames = [];
  const lines = fs.readFileSync(path.join(modDir, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
  return { nameLookup, traitNames, modDir };
}

const argSave = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(path.join(SAVES, argSave));

let { nameLookup, traitNames } = loadLookups();
if (!nameLookup) {
  // Build a minimal name lookup is impossible without the file; but the parser
  // needs nameLookup to validate. Try to locate ANY json in public/.
  console.log("WARN: no name lookup json found in public/. Listing public/*.json:");
  const pubDir = path.join(__dirname, "..", "..", "public");
  for (const f of fs.readdirSync(pubDir)) if (f.endsWith(".json")) console.log("  " + f);
  process.exit(0);
}
if (!traitNames) traitNames = [];

console.log(`Save: ${argSave}  (${(buf.length / 1e6).toFixed(1)} MB)`);
console.log(`nameLookup entries: ${nameLookup.length}, traitNames entries: ${traitNames.length}`);

const chars = findCharacterRecords(buf, nameLookup, traitNames, null);
console.log(`v1 character records found: ${chars.length}`);

const leaders = chars.filter(c => c.isLeader);
const heirs = chars.filter(c => c.isHeir);
console.log(`\nLEADERS (Factionleader trait): ${leaders.length}`);
for (const c of leaders) {
  console.log(`  @0x${c.offset.toString(16)} ${c.firstName} ${c.lastName || ""} age=${c.age} infl=${c.influence} cmd=${c.command} primaryUuid=0x${(c.primaryUuid>>>0).toString(16)} fatherUuid=${c.fatherUuid?("0x"+(c.fatherUuid>>>0).toString(16)):"-"} children=${c.childUuids.length}`);
}
console.log(`\nHEIRS (Factionheir trait): ${heirs.length}`);
for (const c of heirs) {
  console.log(`  @0x${c.offset.toString(16)} ${c.firstName} ${c.lastName || ""} age=${c.age} infl=${c.influence} primaryUuid=0x${(c.primaryUuid>>>0).toString(16)} fatherUuid=${c.fatherUuid?("0x"+(c.fatherUuid>>>0).toString(16)):"-"}`);
}

// Family-edge resolution: how many father/child UUIDs point to a known char?
const byPrimary = new Map();
for (const c of chars) if (c.primaryUuid && c.primaryUuid !== 0xffffffff) byPrimary.set(c.primaryUuid >>> 0, c);

let fatherResolved = 0, fatherTotal = 0, childResolved = 0, childTotal = 0;
for (const c of chars) {
  if (c.fatherUuid) {
    fatherTotal++;
    if (byPrimary.has(c.fatherUuid >>> 0)) fatherResolved++;
  }
  for (const ch of c.childUuids) {
    childTotal++;
    if (byPrimary.has(ch >>> 0)) childResolved++;
  }
}
console.log(`\nFamily edges:`);
console.log(`  fatherUuid resolves to a known primaryUuid: ${fatherResolved}/${fatherTotal}`);
console.log(`  childUuid  resolves to a known primaryUuid: ${childResolved}/${childTotal}`);

// Cross-check: is the leader the oldest / highest influence family member?
// Group by lastName (Greek single-name chars have null lastName; skip those).
const fams = new Map();
for (const c of chars) {
  const key = c.lastName || `_greek_${c.firstName}`;
  if (!fams.has(key)) fams.set(key, []);
  fams.get(key).push(c);
}
console.log(`\nLeader vs family-max influence/age (top families):`);
for (const c of leaders) {
  // find family members sharing a fatherUuid chain — fallback: highest influence overall
  const sameInfl = chars.filter(x => typeof x.influence === "number");
  const maxInfl = sameInfl.reduce((m, x) => Math.max(m, x.influence), 0);
  const maxAge = chars.reduce((m, x) => Math.max(m, x.age), 0);
  console.log(`  leader ${c.firstName} ${c.lastName||""}: infl=${c.influence} (save max ${maxInfl}), age=${c.age} (save max ${maxAge})`);
}
