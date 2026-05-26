// Cross-validate stats block layout across Alexander campaign settlements
// and find more fields (tax rate, garrison size, etc.)

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const T11 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const settlements = ['Epidamnus', 'Pella', 'Sparta', 'Babylon', 'Halicarnassus', 'Tyre', 'Persepolis', 'Ecbatana', 'Taxila'];

console.log('=== Alexander T11 stats block ===');
console.log('Settlement       | creator | level | PO   | income | population');
for (const name of settlements) {
  const off = findUtf16(T11, name);
  if (off === -1) continue;
  // Use SAME offsets from Spain:
  const creator = T11.readInt32LE(off - 583);
  const level = T11.readInt32LE(off - 571);
  const po = T11.readInt32LE(off - 435);
  const income = T11.readInt32LE(off - 127);
  const pop = T11.readInt32LE(off - 35);
  console.log('  ' + name.padEnd(15) + ' | ' + creator.toString().padStart(7) + ' | ' + level.toString().padStart(5) + ' | ' + po.toString().padStart(4) + ' | ' + income.toString().padStart(6) + ' | ' + pop.toString().padStart(8));
}

// Now sweep the stats block for fields that change between T11 and T12
// to find: garrison, tax rate, "can act this turn" flags, etc.
console.log('\n=== Diff T11 vs T12 in EPIDAMNUS stats block (583 bytes before name) ===');
const epi11 = findUtf16(T11, 'Epidamnus');
const epi12 = findUtf16(T12, 'Epidamnus');
console.log('Epidamnus T11 @ 0x' + epi11.toString(16) + ', T12 @ 0x' + epi12.toString(16));
for (let dx = -583; dx <= 0; dx++) {
  const v11 = T11[epi11 + dx];
  const v12 = T12[epi12 + dx];
  if (v11 !== v12) {
    console.log('  dx=' + dx.toString().padStart(4) + ': T11=' + v11.toString().padStart(3) + '  T12=' + v12.toString().padStart(3) + '  Δ=' + (v12 - v11));
  }
}

// Read multi-byte fields at each significant dx
console.log('\n=== u32 fields in Epidamnus stats block (T11 vs T12) ===');
for (let dx = -583; dx <= 0; dx += 4) {
  const v11 = T11.readInt32LE(epi11 + dx);
  const v12 = T12.readInt32LE(epi12 + dx);
  if (v11 !== v12) {
    console.log('  u32@dx=' + dx.toString().padStart(4) + ': T11=' + v11 + '  T12=' + v12 + '  Δ=' + (v12 - v11));
  }
}
