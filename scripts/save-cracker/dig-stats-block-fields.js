// Test memory-claimed stats block layout: 583-byte block ending at settlement name,
// with: owner@+0, level@+12, PO@+148, income@+456, population@+548.
// So FROM settlement name backward:
//   name - 583: owner       (dx=-583)
//   name - 571: level       (dx=-571)
//   name - 435: PO          (dx=-435)
//   name - 127: income      (dx=-127)
//   name - 35:  population  (dx=-35)

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));
const T2 = fs.readFileSync(path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const settlements = ['Corduba', 'Numantia', 'Asturica', 'Scallabis', 'Osca'];

const fields = [
  { dx: -583, name: 'owner' },
  { dx: -571, name: 'level' },
  { dx: -435, name: 'PO' },
  { dx: -127, name: 'income' },
  { dx: -35,  name: 'population' },
];

console.log('Stats block field probe (T1 values):');
console.log('Settlement  ' + fields.map(f => f.name.padEnd(10)).join('  '));
for (const name of settlements) {
  const off = findUtf16(T1, name);
  const vals = fields.map(f => {
    const p = off + f.dx;
    if (p < 0 || p + 4 > T1.length) return 'N/A';
    return T1.readInt32LE(p);
  });
  console.log('  ' + name.padEnd(11) + ' ' + vals.map(v => typeof v === 'number' ? v.toString().padStart(10) : v.padEnd(10)).join('  '));
}

// Also try u8 reads for byte fields
console.log('\nu8 reads at same offsets (T1):');
console.log('Settlement  ' + fields.map(f => f.name.padEnd(10)).join('  '));
for (const name of settlements) {
  const off = findUtf16(T1, name);
  const vals = fields.map(f => {
    const p = off + f.dx;
    if (p < 0 || p >= T1.length) return 'N/A';
    return T1[p];
  });
  console.log('  ' + name.padEnd(11) + ' ' + vals.map(v => typeof v === 'number' ? v.toString().padStart(10) : v.padEnd(10)).join('  '));
}

// Try ALSO if the stats block is AFTER the name (name + 20 + 0..583)
console.log('\nIf stats block is AFTER name (after 20-byte UTF-16 name):');
console.log('Settlement  ' + fields.map(f => f.name.padEnd(10)).join('  '));
for (const name of settlements) {
  const off = findUtf16(T1, name);
  const vals = fields.map(f => {
    const p = off + 20 - f.dx - 583;  // reverse the offset
    if (p < 0 || p + 4 > T1.length) return 'N/A';
    return T1.readInt32LE(p);
  });
  console.log('  ' + name.padEnd(11) + ' ' + vals.map(v => typeof v === 'number' ? v.toString().padStart(10) : v.padEnd(10)).join('  '));
}

// Sweep wider to find what looks like POPULATION (should be 1000-25000)
console.log('\n=== Sweep dx for plausible POPULATION (Spain settlements should have pop 1500-25000) ===');
for (const name of settlements) {
  const off = findUtf16(T1, name);
  console.log('\n' + name + ' @ 0x' + off.toString(16) + ':');
  for (let dx = -700; dx <= 200; dx += 4) {
    const p = off + dx;
    if (p < 0 || p + 4 > T1.length) continue;
    const v = T1.readInt32LE(p);
    if (v >= 1500 && v <= 25000) {
      console.log('  dx=' + dx.toString().padStart(5) + ' (@0x' + p.toString(16) + '): ' + v);
    }
  }
}
