// Verify u32@0xc2de0 is Spain's treasury. Check context and look for
// per-faction treasury array nearby (should be ~20 values for all factions).

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}
const buf = T_FILES[4];

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

console.log('=== Bytes around 0xc2de0 ===');
for (let row = -4; row <= 6; row++) {
  const addr = 0xc2de0 + row * 16;
  if (addr < 0 || addr + 16 > buf.length) continue;
  console.log('  0x' + addr.toString(16) + ': ' + hex(buf, addr, 16) + (row === 0 ? ' ← treasury candidate' : ''));
}

// Find surrounding u32 values that might be other factions' treasuries
console.log('\n=== u32 array around 0xc2de0 ±200 bytes ===');
for (let off = 0xc2de0 - 200; off <= 0xc2de0 + 200; off += 4) {
  if (off + 4 > buf.length) break;
  const v = buf.readUInt32LE(off);
  if (v > 0 && v < 100000 && v % 256 !== 0) {  // not coord
    const marker = off === 0xc2de0 ? ' ← SPAIN' : '';
    console.log('  u32@0x' + off.toString(16) + ' = ' + v + marker);
  }
}

// Show the same range across all 4 turns
console.log('\n=== Cross-turn values around 0xc2de0 ===');
for (let off = 0xc2de0 - 100; off <= 0xc2de0 + 100; off += 4) {
  const vals = [1, 2, 3, 4].map(t => T_FILES[t].readUInt32LE(off));
  if (vals.every(v => v === 0)) continue;
  if (vals.every(v => v === vals[0])) continue;  // constant
  if (vals.some(v => v > 1000000)) continue;
  console.log('  u32@0x' + off.toString(16) + ': T1=' + vals[0] + ' T2=' + vals[1] + ' T3=' + vals[2] + ' T4=' + vals[3]);
}
