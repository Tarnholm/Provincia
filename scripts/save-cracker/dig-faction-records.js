// Check the 2KB gap between settlements (end ~0x3c000) and mercenary pools (0x3e000)
// for per-faction records with treasury.

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

function hex(buf, off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

const buf = T_FILES[4];

// Print bytes in 0x3c000..0x3e300 region (2.3 KB)
console.log('=== 0x3c000..0x3e300 (just before mercenary pools) ===');
for (let p = 0x3c000; p < 0x3e300; p += 32) {
  console.log('  0x' + p.toString(16) + ': ' + hex(buf, p, 32));
}

// Hunt for u32 values varying across T1→T4 in this zone
console.log('\n=== u32 values varying across T1→T4 in 0x3c000..0x3e300 ===');
for (let off = 0x3c000; off < 0x3e300; off += 4) {
  const vals = [1, 2, 3, 4].filter(t => T_FILES[t]).map(t => T_FILES[t].readUInt32LE(off));
  if (vals.length < 4) continue;
  if (new Set(vals).size === 1) continue;
  if (vals.some(v => v > 1000000)) continue;
  console.log('  u32@0x' + off.toString(16) + ' vals=[' + vals.join(', ') + ']');
}
