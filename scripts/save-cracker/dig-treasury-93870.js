// Verify 0x93870 as treasury. Check context and cross-validate.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

console.log('=== u32@0x93870 across ALL Spain saves ===');
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const year = buf.readInt32LE(0x514);
  const v = buf.readUInt32LE(0x93870);
  const v2 = buf.readUInt32LE(0xc9dcc);
  console.log('  year=' + year + ' size=' + buf.length + ' u32@0x93870=' + v + ' u32@0xc9dcc=' + v2 + '  ' + f);
}

// Context around 0x93870 in the T4 Start save
console.log('\n=== Context around 0x93870 (T4 Start save) ===');
const t4 = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
for (let row = -4; row <= 6; row++) {
  const addr = 0x93870 + row * 16;
  if (addr < 0 || addr + 16 > t4.length) continue;
  console.log('  0x' + addr.toString(16) + ': ' + hex(t4, addr, 16) + (row === 0 ? ' ← Spain treasury?' : ''));
}

// Context around 0xc9dcc
console.log('\n=== Context around 0xc9dcc (T4 Start save) ===');
for (let row = -4; row <= 6; row++) {
  const addr = 0xc9dcc + row * 16;
  if (addr < 0 || addr + 16 > t4.length) continue;
  console.log('  0x' + addr.toString(16) + ': ' + hex(t4, addr, 16) + (row === 0 ? ' ← maybe related?' : ''));
}
