#!/usr/bin/env node
// Find the unit-record context around 0x30da0. Look backward for the unit name.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

// Look BACKWARD from 0x30da0 for ASCII strings (unit names)
const addr = 0x30da0;
console.log(`Searching backward from 0x${addr.toString(16)} for ASCII strings:`);
const SCAN = 1024;
let runStart = -1;
for (let i = addr - SCAN; i < addr + 256; i++) {
  const c = A[i];
  if (c >= 0x20 && c <= 0x7e) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      const len = i - runStart;
      if (len >= 5) {
        const s = A.slice(runStart, i).toString('binary');
        console.log(`  0x${runStart.toString(16)}: len=${len} "${s}"`);
      }
      runStart = -1;
    }
  }
}

// Dump 256 bytes before 0x30da0
console.log(`\n--- Context (-256..+64) around 0x${addr.toString(16)} ---`);
for (let i = addr - 256; i < addr + 64; i += 16) {
  let line = `0x${i.toString(16)}: `;
  let asc = '';
  for (let j = 0; j < 16; j++) {
    const v = A[i+j];
    line += v.toString(16).padStart(2, '0') + ' ';
    asc += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : '.';
  }
  console.log(`${line}  ${asc}`);
}

// Same for 0x122277
console.log(`\n=== Context around 0x122277 (-256..+128) ===`);
const addr2 = 0x122277;
console.log(`Searching backward from 0x${addr2.toString(16)} for ASCII strings:`);
runStart = -1;
for (let i = addr2 - SCAN; i < addr2 + 256; i++) {
  const c = A[i];
  if (c >= 0x20 && c <= 0x7e) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      const len = i - runStart;
      if (len >= 5) {
        const s = A.slice(runStart, i).toString('binary');
        console.log(`  0x${runStart.toString(16)}: len=${len} "${s}"`);
      }
      runStart = -1;
    }
  }
}
