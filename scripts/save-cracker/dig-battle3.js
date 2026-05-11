#!/usr/bin/env node
// Look for character records near the damage sites. Are they associated with characters
// that won/lost a battle?

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

// Address 0x111ec - inside settlement record
// Address 0x30da0 - some other record

// Search WIDER: maybe there are more diffs hidden in this small sample.
// Let me re-check: find all u32 fields where they differ
console.log('=== Per-u32 diff ===');
const u32diffs = [];
for (let i = 0; i + 4 <= A.length; i++) {
  const aV = A.readUInt32LE(i);
  const bV = B.readUInt32LE(i);
  if (aV !== bV) {
    // Check if this is a "small int" field (likely a stat)
    u32diffs.push({ off: i, aV, bV });
  }
}
console.log(`Total u32 positions that differ: ${u32diffs.length}`);
// Deduplicate by groupings — adjacent ones are the same diff
const merged = [];
let curStart = -1;
let curEnd = -1;
for (const d of u32diffs) {
  if (d.off === curEnd) {
    curEnd = d.off + 1;
  } else {
    if (curStart >= 0) merged.push([curStart, curEnd]);
    curStart = d.off;
    curEnd = d.off + 1;
  }
}
if (curStart >= 0) merged.push([curStart, curEnd]);

console.log(`Merged into ${merged.length} regions`);

// Now check what u32-aligned values changed
console.log('\nu32-aligned reads (only if offset is multiple of 4):');
for (let i = 0; i + 4 <= A.length; i += 4) {
  const aV = A.readUInt32LE(i);
  const bV = B.readUInt32LE(i);
  if (aV !== bV) {
    const aI32 = A.readInt32LE(i);
    const bI32 = B.readInt32LE(i);
    console.log(`  0x${i.toString(16).padStart(8, '0')}: u32 A=${aV} (0x${aV.toString(16)}) B=${bV} (0x${bV.toString(16)}) | i32 A=${aI32} B=${bI32}`);
  }
}

// Look around 0x111ec — find the unit-record start (look for the unit name pattern)
console.log('\n=== Context around 0x111ec (-256..+64) ===');
const ctxStart = 0x111ec - 256;
for (let i = ctxStart; i < 0x111ec + 64; i += 16) {
  let line = `0x${i.toString(16)}: `;
  let asc = '';
  for (let j = 0; j < 16; j++) {
    const v = A[i+j];
    line += v.toString(16).padStart(2, '0') + ' ';
    asc += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : '.';
  }
  console.log(`${line}  ${asc}`);
}
