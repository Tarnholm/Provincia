// dig-unit-container-baseline.js
// Session: decode the UNIT-level container record around the soldier array.
//
// Step 1 (this script): establish a baseline. Run the canonical findUnitRecords
// parser over the full arretium controlled sequence, then for each Arretium-
// region unit dump the full byte trailer (region terminator -> next record) so
// we can see the variant-A container layout and what changes when retraining.
//
// Pure-read diagnostic. No app code touched.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('../../src/unitParser.js');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

const SAVES = [
  ['PRE',   'save_arretium pre retrained..sav'],
  ['QUEUE', 'save_arretium queued retrain.sav'],
  ['T2',    'save_arretium retrained turn 2.sav'],
  ['T2Q',   'save_arretium turn 2 new unit queued.sav'],
  ['T3',    'save_arretium turn 3.sav'],
  ['T4',    'save_arretium turn 4.sav'],
];

function hexRow(buf, off, n) {
  const hex = Array.from(buf.slice(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(buf.slice(off, off + n)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  return hex.padEnd(n * 3) + ' |' + ascii + '|';
}

for (const [tag, file] of SAVES) {
  const buf = fs.readFileSync(path.join(BASE_R, file));
  const recs = findUnitRecords(buf);
  const arretium = recs.filter(r => r.region === 'Etruria');
  console.log('\n============================================================');
  console.log(`${tag}  (${file})  size=${buf.length}  units=${recs.length}  Etruria-units=${arretium.length}`);
  console.log('============================================================');
  // Tally unit names in Etruria (the retrain happens at Arretium in Etruria region)
  const byName = {};
  for (const r of arretium) byName[r.name] = (byName[r.name] || 0) + 1;
  console.log('Etruria unit-name tally:', JSON.stringify(byName));
  // Show first few hastati/principes/equites (the retrain targets) with full fields
  const targets = arretium.filter(r => /hastati|princip|equit|triarii|velit/.test(r.name));
  console.log(`\nEtruria combat units (${targets.length}):`);
  for (const r of targets.slice(0, 12)) {
    console.log(`  @0x${r.offset.toString(16)} "${r.name}" sold=${r.soldiers}/${r.maxSoldiers} xp=${r.xp} wpn=${r.weaponUpgrade} arm=${r.armourUpgrade} cmdr=${r.commanderUuid}`);
  }
}
