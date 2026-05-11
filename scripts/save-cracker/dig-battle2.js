#!/usr/bin/env node
// Investigate the specific bytes that changed when units took damage.
// Suspects: 0x111ec (100→50), 0x30da0 (55→49), 0x122277 (01→00).
// Likely these are soldier counts in unit records.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

for (const addr of [0x111ec, 0x30da0, 0x122277]) {
  console.log(`\n=== Byte @ 0x${addr.toString(16)} (A=${A[addr]}, B=${B[addr]}) ===`);
  // Show 64 bytes before and 32 after
  const ctxStart = Math.max(0, addr - 64);
  const ctxEnd = Math.min(A.length, addr + 64);
  console.log(`A context [-64..+64]:`);
  for (let i = ctxStart; i < ctxEnd; i += 16) {
    let aLine = `  0x${i.toString(16)}: `;
    let asc = '';
    for (let j = 0; j < 16 && i+j < ctxEnd; j++) {
      const v = A[i+j];
      aLine += v.toString(16).padStart(2, '0');
      if (i+j === addr) aLine += '*'; else aLine += ' ';
      asc += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : '.';
    }
    console.log(`${aLine}  ${asc}`);
  }
  console.log(`B context [-64..+64]:`);
  for (let i = ctxStart; i < ctxEnd; i += 16) {
    let bLine = `  0x${i.toString(16)}: `;
    let asc = '';
    for (let j = 0; j < 16 && i+j < ctxEnd; j++) {
      const v = B[i+j];
      bLine += v.toString(16).padStart(2, '0');
      if (i+j === addr) bLine += '*'; else bLine += ' ';
      asc += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : '.';
    }
    console.log(`${bLine}  ${asc}`);
  }
}
