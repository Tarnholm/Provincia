#!/usr/bin/env node
// Compare saveturn1construction → saveturn2start. The construction "in progress" on Pella
// should have been advanced (or possibly completed). Building chain might also extend.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn2start.sav'));

const pellaUtf16 = Buffer.from('Pella', 'utf16le');
const aPella = A.indexOf(pellaUtf16);
const bPella = B.indexOf(pellaUtf16);
console.log(`A: Pella @ 0x${aPella.toString(16)}, B: Pella @ 0x${bPella.toString(16)}`);

const cstr = Buffer.from('core_building\0');
const aCb = A.indexOf(cstr, aPella);
const bCb = B.indexOf(cstr, bPella);
console.log(`A: core_building @ 0x${aCb.toString(16)} (rel +${aCb - aPella})`);
console.log(`B: core_building @ 0x${bCb.toString(16)} (rel +${bCb - bPella})`);

const aPre = A.slice(aPella, aCb);
const bPre = B.slice(bPella, bCb);

console.log(`\nA Pella..core_building (len=${aPre.length}):`);
hex(aPre);
console.log(`\nB Pella..core_building (len=${bPre.length}):`);
hex(bPre);

function hex(buf) {
  for (let i = 0; i < buf.length; i += 16) {
    let line = `  +${i.toString().padStart(4)}: `;
    let asc = '';
    for (let j = 0; j < 16 && i+j < buf.length; j++) {
      const b = buf[i+j];
      line += b.toString(16).padStart(2, '0') + ' ';
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.';
    }
    console.log(`${line.padEnd(64)} ${asc}`);
  }
}

// Also check the "20 03" (u32=800) value across all saves at Pella core_building region:
console.log('\n=== Search for u32=800 (0x320) in Pella region across all saves ===');
const saves = [
  'save_saveturn1start.sav',
  'save_saveturn1building.sav',
  'save_saveturn1construction.sav',
  'save_saveturn1move.sav',
  'save_saveturn2start.sav',
  'save_Noarmiesmovedturn1.sav',
];
for (const s of saves) {
  const buf = fs.readFileSync(path.join(dir, s));
  const pName = buf.indexOf(pellaUtf16);
  // Look for u32=800 (=0x320) in Pella+0..+200
  const hits = [];
  for (let i = pName; i < pName + 200; i++) {
    if (buf.readUInt32LE(i) === 800) {
      hits.push(i - pName);
    }
  }
  console.log(`  ${s}: u32=800 at Pella+${hits.join(', +')}`);
}
