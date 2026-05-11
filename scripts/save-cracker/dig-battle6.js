#!/usr/bin/env node
// Look at 0x122277 - the bool 01→00 flag. Context shows nearby self-pointers and other small ints.
// Search backward for unit name / character name.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

const addr = 0x122277;

// Search backward for nearest sub-unit-name or character ID
console.log('Searching backward up to 2KB for strings:');
let runStart = -1;
const strings = [];
for (let i = Math.max(0, addr - 4096); i < addr + 1024; i++) {
  const c = A[i];
  if (c >= 0x20 && c <= 0x7e) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      const len = i - runStart;
      if (len >= 5) {
        const s = A.slice(runStart, i).toString('binary');
        strings.push({ pos: runStart, len, s });
      }
      runStart = -1;
    }
  }
}
for (const s of strings) {
  console.log(`  0x${s.pos.toString(16)}: len=${s.len} "${s.s}"`);
}

// Hexdump wider context
console.log('\n--- Wider context (-128..+128) ---');
for (let i = addr - 128; i < addr + 128; i += 16) {
  let line = `0x${i.toString(16)}: `;
  let asc = '';
  for (let j = 0; j < 16; j++) {
    const v = A[i+j];
    line += v.toString(16).padStart(2, '0') + ' ';
    asc += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : '.';
  }
  console.log(`${line}  ${asc}`);
}

console.log('\nB context');
for (let i = addr - 128; i < addr + 128; i += 16) {
  let line = `0x${i.toString(16)}: `;
  let asc = '';
  for (let j = 0; j < 16; j++) {
    const v = B[i+j];
    line += v.toString(16).padStart(2, '0') + ' ';
    asc += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : '.';
  }
  console.log(`${line}  ${asc}`);
}
