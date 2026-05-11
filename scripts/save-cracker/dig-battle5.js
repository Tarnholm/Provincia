#!/usr/bin/env node
// Look much wider around 0x30da0 — maybe the unit record is far before it.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

// First check what type of structure 0x30da0 is in.
// The pattern is a fixed-stride 48-byte record. Look at all records BEFORE 0x30da0 with the same stride.
console.log('Scanning at 48-byte stride from 0x30000 to 0x32000:');
for (let i = 0x30000; i < 0x32000; i += 48) {
  const u1 = A.readUInt32LE(i);
  const u2 = A.readUInt32LE(i + 4);
  const u3 = A.readUInt32LE(i + 8);
  const u4 = A.readUInt32LE(i + 12);
  const u5 = A.readUInt32LE(i + 16);
  console.log(`  0x${i.toString(16)}: ${u1}, ${u2}, ${u3}, ${u4}, ${u5}`);
}

// Search BACKWARDS from 0x30da0 for any cstring of length ≥ 8 — looking for the unit type name
console.log('\nSearching backward up to 16KB for ASCII strings ≥6 chars:');
const SCAN = 16 * 1024;
let runStart = -1;
const strings = [];
for (let i = Math.max(0, 0x30da0 - SCAN); i < 0x30da0; i++) {
  const c = A[i];
  if (c >= 0x20 && c <= 0x7e) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      const len = i - runStart;
      if (len >= 6) {
        const s = A.slice(runStart, i).toString('binary');
        strings.push({ pos: runStart, len, s });
      }
      runStart = -1;
    }
  }
}
// Show closest 10 to 0x30da0
for (const s of strings.slice(-15)) {
  console.log(`  0x${s.pos.toString(16)}: len=${s.len} "${s.s}"`);
}

// Also check forward
console.log('\nSearching forward up to 4KB:');
runStart = -1;
for (let i = 0x30da0; i < 0x30da0 + 4096; i++) {
  const c = A[i];
  if (c >= 0x20 && c <= 0x7e) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      const len = i - runStart;
      if (len >= 6) {
        const s = A.slice(runStart, i).toString('binary');
        console.log(`  0x${runStart.toString(16)}: len=${len} "${s}"`);
      }
      runStart = -1;
    }
  }
}
