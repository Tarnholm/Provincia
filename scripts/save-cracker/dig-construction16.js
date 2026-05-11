#!/usr/bin/env node
// Just list all ASCII cstring occurrences in Pella+0..3500 for each save.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const saves = [
  'save_saveturn1start.sav',
  'save_saveturn1building.sav',
  'save_saveturn1construction.sav',
  'save_saveturn1move.sav',
  'save_saveturn2start.sav',
  'save_Noarmiesmovedturn1.sav',
];

const pellaUtf16 = Buffer.from('Pella', 'utf16le');

for (const s of saves) {
  const buf = fs.readFileSync(path.join(dir, s));
  const pName = buf.indexOf(pellaUtf16);
  console.log(`\n=== ${s} (Pella @ 0x${pName.toString(16)}) ===`);
  // Walk Pella +0..+3500 and find runs of >=4 printable ASCII chars
  const SCAN = 3500;
  let runStart = -1;
  for (let i = 0; i < SCAN; i++) {
    const idx = pName + i;
    const c = buf[idx];
    if (c >= 0x20 && c <= 0x7e) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0) {
        const len = i - runStart;
        if (len >= 6) {
          const s2 = buf.slice(pName + runStart, pName + i).toString('binary');
          console.log(`  +${runStart.toString().padStart(4)}: len=${len.toString().padStart(3)} "${s2}"`);
        }
        runStart = -1;
      }
    }
  }
}
