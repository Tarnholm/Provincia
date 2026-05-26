// dig-bloodline-trait-verify.js
//
// VERIFY whether the v1 parser's trait-ID→name mapping is correct, by
// dumping the raw trait IDs of records the parser flags as Factionleader and
// checking whether the SAME tid appears on exactly one char per faction.
//
// 211 "leaders" in macedon t0 is implausible (~23 factions => ~23 leaders).
// Either (a) the export-declaration-order != save trait-ID order, or
// (b) the parser's trait list is reading garbage on many records.
//
// Approach: index trait IDs by frequency. The real Factionleader trait ID
// should appear ~once per faction (~20-40 times in a 23-faction save), NOT
// 211 times. Compare with whatever ID the export-order maps to "Factionleader".

const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const MOD_DIR = "C:\\RIS\\RIS\\data";

const nameLookup = fs.readFileSync(path.join(MOD_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitDeclOrder = [];
for (const line of fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/);
  if (tm) traitDeclOrder.push(tm[1]);
}
const flIdxDecl = traitDeclOrder.indexOf("Factionleader");
const fhIdxDecl = traitDeclOrder.indexOf("Factionheir");
console.log(`export declaration order: Factionleader idx=${flIdxDecl}, Factionheir idx=${fhIdxDecl}, total traits=${traitDeclOrder.length}`);

const argSave = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(path.join(SAVES, argSave));
console.log(`Save: ${argSave}`);

// Parse with declaration order (what production uses)
const chars = findCharacterRecords(buf, nameLookup, traitDeclOrder, null);
console.log(`chars: ${chars.length}`);

// Frequency of each trait id across all parsed chars (use the resolved name)
const freq = new Map();
for (const c of chars) {
  for (const t of c.traits) {
    freq.set(t.id, (freq.get(t.id) || 0) + 1);
  }
}
// What is the frequency of the tid the decl-order calls Factionleader?
console.log(`\nFreq of tid=${flIdxDecl} (decl "Factionleader"): ${freq.get(flIdxDecl) || 0}`);
console.log(`Freq of tid=${fhIdxDecl} (decl "Factionheir"): ${freq.get(fhIdxDecl) || 0}`);

// The REAL leader trait should appear ~20-45 times (once per faction). Find
// the tid(s) whose frequency is in [15, 60] and whose decl-name contains
// "leader"/"heir"/"faction" — that pinpoints the true ID if order is offset.
console.log(`\nTrait IDs with freq in [15,60] (candidate per-faction-unique traits):`);
const cands = [...freq.entries()].filter(([, n]) => n >= 15 && n <= 60).sort((a, b) => a[0] - b[0]);
for (const [tid, n] of cands) {
  const declName = tid < traitDeclOrder.length ? traitDeclOrder[tid] : "?";
  console.log(`  tid=${tid} freq=${n} declName="${declName}"`);
}

// Also: distribution of trait counts — sanity check parser isn't reading junk
const tcDist = {};
for (const c of chars) { const k = Math.min(c.traits.length, 20); tcDist[k] = (tcDist[k] || 0) + 1; }
console.log(`\ntrait-count distribution (capped 20):`, JSON.stringify(tcDist));
