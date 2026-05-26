// Diff two Macedon Turn 1 saves: one before tax change, one after.
// The byte that changed in Pella's stats block IS the tax rate.

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

// Find the "before" and "after" saves
const allFiles = fs.readdirSync(BASE_A).filter(f => f.endsWith('.sav') && f.includes('Macedon   Turn 1'));
console.log('Turn 1 Macedon saves:');
for (const f of allFiles) console.log('  ' + f);

const base = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav'));
const afterTax = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1 taxes increased in Pella.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const pella1 = findUtf16(base, 'Pella');
const pella2 = findUtf16(afterTax, 'Pella');
console.log('\nPella in base @ 0x' + pella1.toString(16));
console.log('Pella in afterTax @ 0x' + pella2.toString(16));
console.log('Shift: ' + (pella2 - pella1));

// Compare Pella's stats block (-583..0 from name) byte by byte
console.log('\n=== Bytes that differ in Pella stats block ===');
for (let dx = -583; dx <= 0; dx++) {
  const v1 = base[pella1 + dx];
  const v2 = afterTax[pella2 + dx];
  if (v1 !== v2) {
    console.log('  dx=' + dx.toString().padStart(4) + ': base=' + v1 + '  afterTax=' + v2 + '  Δ=' + (v2 - v1));
  }
}

// Also check u32 at each dx
console.log('\n=== u32 differences (4-byte windows) ===');
for (let dx = -583; dx <= 0; dx++) {
  const v1 = base.readInt32LE(pella1 + dx);
  const v2 = afterTax.readInt32LE(pella2 + dx);
  if (v1 !== v2) {
    console.log('  u32@dx=' + dx.toString().padStart(4) + ': base=' + v1 + '  afterTax=' + v2 + '  Δ=' + (v2 - v1));
  }
}
