#!/usr/bin/env node
// Look at save_saveturn1building.sav (same as saveturn1start size+6) — diff Pella record.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1building.sav'));

console.log(`A: ${A.length}, B: ${B.length}, Δ=${B.length-A.length}`);

const pellaUtf16 = Buffer.from('Pella', 'utf16le');
const aPella = A.indexOf(pellaUtf16);
const bPella = B.indexOf(pellaUtf16);
console.log(`Pella A: 0x${aPella.toString(16)}, B: 0x${bPella.toString(16)}`);

const cstr = Buffer.from('core_building\0');
const aCb = A.indexOf(cstr, aPella);
const bCb = B.indexOf(cstr, bPella);
console.log(`core_building A: 0x${aCb.toString(16)} (rel +${aCb - aPella})`);
console.log(`core_building B: 0x${bCb.toString(16)} (rel +${bCb - bPella})`);

// Show byte-by-byte diff for the entire Pella region
console.log(`\n=== A vs B byte diff around Pella ===`);
const SCAN = 200;
let diffCount = 0;
for (let i = -50; i < SCAN; i++) {
  const aIdx = aPella + i;
  const bIdx = bPella + i;
  if (A[aIdx] !== B[bIdx]) {
    diffCount++;
    if (diffCount > 60) break;
    console.log(`  +${i}: A=0x${A[aIdx].toString(16).padStart(2,'0')} B=0x${B[bIdx].toString(16).padStart(2,'0')}`);
  }
}

// Show first 110 bytes of each
console.log(`\nA Pella+0..120:`);
hexdump(A.slice(aPella, aPella + 120));
console.log(`B Pella+0..120:`);
hexdump(B.slice(bPella, bPella + 120));

function hexdump(buf) {
  for (let i = 0; i < buf.length; i += 16) {
    let hex = '';
    let asc = '';
    for (let j = 0; j < 16 && i+j < buf.length; j++) {
      const b = buf[i+j];
      hex += b.toString(16).padStart(2, '0') + ' ';
      asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : '.';
    }
    console.log(`    +${i.toString().padStart(4)} ${hex.padEnd(48)}  ${asc}`);
  }
}
