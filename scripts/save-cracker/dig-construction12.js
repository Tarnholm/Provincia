#!/usr/bin/env node
// Cross-save Pella analysis. Find core_building sub-record start, then look at
// the bytes inserted BEFORE it in each save.

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

const cstr = Buffer.from('core_building\0');
const pellaUtf16 = Buffer.from('Pella', 'utf16le');

console.log('save / Pella name / first core_building after Pella / pre-core_building hex:');
for (const s of saves) {
  const buf = fs.readFileSync(path.join(dir, s));
  const pName = buf.indexOf(pellaUtf16);
  if (pName < 0) {
    console.log(`${s}: no Pella found`);
    continue;
  }
  let cbPos = -1;
  let pos = pName;
  while ((pos = buf.indexOf(cstr, pos)) !== -1) {
    if (pos > pName && pos < pName + 500) {
      cbPos = pos;
      break;
    }
    pos += 1;
  }
  if (cbPos < 0) {
    console.log(`${s}: no core_building near Pella`);
    continue;
  }
  const rel = cbPos - pName;
  const insertHex = buf.slice(pName + 50, cbPos).toString('hex');
  console.log(`\n${s}:`);
  console.log(`  Pella name @ 0x${pName.toString(16)}, core_building @ +${rel}`);
  console.log(`  pre-core_building (50 bytes after pName): ${insertHex}`);
  // Compute the structural feature: is there a "20 03 00 00" anywhere in this region?
  // = u32 800 = building id?
  for (let i = pName + 50; i < cbPos - 4; i += 4) {
    const v = buf.readUInt32LE(i);
    if (v >= 1 && v <= 10000) {
      // looks like a small int / possible building id
      // skip noisy zeros and 1s
      if (v > 50 && v < 5000) {
        console.log(`    rel +${i - pName}: u32=${v} (possible building/turns field)`);
      }
    }
  }
}
