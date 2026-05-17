// Look for SETTLEMENT_MECHANICS_STATS section records (5 instances per registry).
// Likely per-culture settlement mechanic params.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Look for 5-record clusters — find self-pointers with ~80-200 byte sizes
// and see if 5 of them are clustered together
const selfPtrs = [];
for (let off = 0x100; off < buf.length - 8; off += 1) {
  const v = buf.readUInt32LE(off);
  if (v === off) {
    const size = buf.readUInt32LE(off + 4);
    if (size > 30 && size < 500) {
      selfPtrs.push({ off, size });
    }
  }
}

// Find clusters of 5 consecutive self-pointers
console.log('=== Clusters of 5 nearby self-pointers ===');
for (let i = 0; i + 4 < selfPtrs.length; i++) {
  const span = selfPtrs[i + 4].off - selfPtrs[i].off;
  if (span < 2000) {
    const sizes = selfPtrs.slice(i, i + 5).map(s => s.size);
    // Sizes should be similar (within 50% of each other)
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    if (maxSize / minSize < 3) {
      console.log('  Cluster of 5: 0x' + selfPtrs[i].off.toString(16) + ' to 0x' +
        selfPtrs[i+4].off.toString(16) + ' (span ' + span + ' bytes), sizes: ' + sizes.join(','));
      // Print first record's bytes
      const r = selfPtrs[i];
      console.log('    First record bytes: ' + hex(r.off, Math.min(64, r.size + 8)));
    }
  }
}

// Also look for 3-record clusters (BUILDING_CONSTRUCTION_ITEM, WIN_CONDITION, etc.)
console.log('\n=== Clusters of 3 nearby self-pointers (size 50-500) ===');
let count = 0;
for (let i = 0; i + 2 < selfPtrs.length; i++) {
  const span = selfPtrs[i + 2].off - selfPtrs[i].off;
  if (span < 800 && span > 60) {
    const sizes = selfPtrs.slice(i, i + 3).map(s => s.size);
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);
    if (maxSize / minSize < 4 && minSize > 40 && minSize < 300) {
      console.log('  Cluster of 3: 0x' + selfPtrs[i].off.toString(16) + ' to 0x' +
        selfPtrs[i+2].off.toString(16) + ' (span ' + span + '), sizes: ' + sizes.join(','));
      count++;
      if (count > 10) break;
    }
  }
}
