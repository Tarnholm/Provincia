// 34 FACTION records × ~380 bytes = ~13 KB. The 0x14a0..0x4800 zone is ~13 KB.
// Check if it contains 34 FACTION records with treasury.

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

// 34 records in 13 KB = ~380 bytes each. Let me see if there's an obvious
// record boundary pattern in 0x14a0..0x4800.

// First, look at the start of zone
console.log('=== 0x14a0..0x1600 (start of unmapped zone) ===');
for (let p = 0x14a0; p < 0x1600; p += 32) {
  console.log('  0x' + p.toString(16) + ': ' + hex(buf, p, 32));
}

// Look for repeating pattern. If 34 records of equal size, stride = (0x4800 - 0x14a0) / 34
const zoneSize = 0x4800 - 0x14a0;
const idealStride = zoneSize / 34;
console.log('\nZone size: ' + zoneSize + ', ideal stride for 34 records: ' + idealStride.toFixed(1));

// Try to detect record boundaries by looking for consistent markers
// Sample 12 bytes at each ideal-stride point
for (let i = 0; i < 34; i++) {
  const off = 0x14a0 + Math.round(i * idealStride);
  console.log('  rec[' + String(i).padStart(2) + '] @ 0x' + off.toString(16) + ': ' + hex(buf, off, 16));
}
