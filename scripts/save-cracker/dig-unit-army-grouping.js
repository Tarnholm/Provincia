// dig-unit-army-grouping.js
// Investigate how units group into ARMIES. Hypotheses:
//   H1: units in one army are CONSECUTIVE in file order, led by a general
//       (commanderUuid set), terminated by the next general / region change.
//   H2: there is a per-unit "army uuid" field that repeats across an army's units.
//   H3: an army record (world position) lists member unit uuids.
//
// Approach: print the file-order sequence of unit records with name/region/
// commanderUuid, and look at the bytes BEFORE the name pstr (the unit's header
// prefix) for a repeating army-uuid candidate.
//
// Pure-read.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const recs = findUnitRecords(buf).sort((a, b) => a.offset - b.offset);

console.log(`Total units (file order): ${recs.length}`);

// Print a window of consecutive units near Arretium (Etruria) to see grouping.
const start = recs.findIndex(r => r.region === 'Etruria');
console.log(`\n=== file-order window around first Etruria unit (idx ${start}) ===`);
console.log('idx  offset      gap   name                              region            cmdr      sold');
for (let i = Math.max(0, start - 3); i < Math.min(recs.length, start + 30); i++) {
  const r = recs[i];
  const gap = i > 0 ? r.offset - recs[i - 1].offset : 0;
  console.log(`${i.toString().padStart(4)} 0x${r.offset.toString(16).padStart(8)} ${gap.toString().padStart(5)}  ${r.name.padEnd(33)} ${(r.region||'').padEnd(17)} ${(r.commanderUuid||'-').toString().padEnd(9)} ${r.soldiers}`);
}

// Look at the bytes immediately BEFORE each unit name pstr (header prefix).
// For consecutive units in the same army we expect a shared army-uuid or a
// back-pointer. Dump 32 bytes before the name for a few Etruria units.
console.log('\n=== 32 bytes before name pstr (header prefix) for Etruria units ===');
for (let i = start; i < Math.min(recs.length, start + 12); i++) {
  const r = recs[i];
  const from = Math.max(0, r.offset - 32);
  const hex = Array.from(buf.slice(from, r.offset)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  ${r.name.padEnd(24)} pre: ${hex}`);
}

// H2 test: scan the 64 bytes before each unit name for a u32 that is SHARED by
// 2+ consecutive units (army uuid). Report runs.
console.log('\n=== shared-u32-before-name runs (army uuid candidate) ===');
for (let dx = -64; dx <= -4; dx += 4) {
  // build per-unit value
  const vals = recs.map(r => (r.offset + dx >= 0 ? buf.readUInt32LE(r.offset + dx) : 0));
  // count consecutive runs of identical non-trivial values
  let runs = 0, maxRun = 1, cur = 1, runLens = {};
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] === vals[i - 1] && vals[i] !== 0 && vals[i] !== 0xffffffff) { cur++; }
    else { if (cur >= 2) { runs++; runLens[cur] = (runLens[cur] || 0) + 1; } maxRun = Math.max(maxRun, cur); cur = 1; }
  }
  if (runs > 0) console.log(`  dx=${dx}: ${runs} runs(>=2), maxRun=${maxRun}, lenHist=${JSON.stringify(runLens)}`);
}
