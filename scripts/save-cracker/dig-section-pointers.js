// Look at the area after section registry (0xde0..0x1190) for pointers
// to actual section records (FACTION at 34 instances etc.)

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 1. Look for u32 file offsets in 0xde0..0x1190 that point into the file
console.log('=== u32 values in 0xde0..0x1190 that look like file offsets ===');
const fileSize = buf.length;
for (let off = 0xde0; off < 0x1190; off += 4) {
  const v = buf.readUInt32LE(off);
  if (v >= 0x1190 && v < fileSize - 4) {
    // Plausible file offset
    console.log('  u32@0x' + off.toString(16) + ' → 0x' + v.toString(16) + ' (' + ((v / fileSize) * 100).toFixed(1) + '%)');
  }
}

// 2. Look for self-pointers (u32 == offset)
console.log('\n=== Self-pointers in 0xde0..0x1190 ===');
for (let off = 0xde0; off < 0x1190; off += 1) {
  const v = buf.readUInt32LE(off);
  if (v === off) {
    console.log('  Self-ptr @ 0x' + off.toString(16));
  }
}

// 3. Search the file for u32 values that equal the name offsets of "FACTION" (0x671)
// This would be a "reference to FACTION" pointer
console.log('\n=== References to section name offsets ===');
const sectionNames = [
  { name: 'FACTION', off: 0x671 },
  { name: 'ECONOMICS_DATA', off: 0x5ff },
  { name: 'MAP_REGIONS', off: 0x741 },
  { name: 'CHARACTER_RECORD', off: 0xa75 },
  { name: 'SETTLEMENT', off: 0xb1b },
];
for (const sn of sectionNames) {
  let count = 0;
  let firstHit = -1;
  for (let off = 0; off < fileSize - 4; off += 4) {
    const v = buf.readUInt32LE(off);
    if (v === sn.off) {
      count++;
      if (firstHit === -1) firstHit = off;
    }
  }
  console.log('  References to "' + sn.name + '" (name@0x' + sn.off.toString(16) + '): ' + count + ' (first at 0x' + firstHit.toString(16) + ')');
}

// 4. Dump the whole 0xde0..0x1190 zone
console.log('\n=== 0xde0..0x1190 (944 bytes) ===');
for (let p = 0xde0; p < 0x1190; p += 32) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 32));
}
