#!/usr/bin/env node
// List all cb 00 00 00 settlement markers in both saves, with the bytes around them.
// Look for settlement records (much smaller in Alexander - only 43 settlements total).

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

function findCb(buf) {
  const out = [];
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0xcb && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 0) {
      out.push(i);
    }
  }
  return out;
}

const cA = findCb(A);
const cB = findCb(B);
console.log(`cb markers A: ${cA.length}, B: ${cB.length}`);
console.log(`A markers (first 10): ${cA.slice(0,10).map(p => '0x'+p.toString(16)).join(', ')}`);
console.log(`B markers (first 10): ${cB.slice(0,10).map(p => '0x'+p.toString(16)).join(', ')}`);

// Check stride between consecutive markers
console.log(`\nA strides between consecutive markers:`);
for (let i = 1; i < Math.min(cA.length, 25); i++) {
  console.log(`  [${i-1}]→[${i}]: 0x${cA[i].toString(16)} - 0x${cA[i-1].toString(16)} = ${cA[i] - cA[i-1]}`);
}

// Show the bytes around the first marker
console.log(`\nFirst marker A @ 0x${cA[0].toString(16)} (next 64 bytes):`);
console.log(`  ${A.slice(cA[0], cA[0]+64).toString('hex')}`);
console.log(`First marker B @ 0x${cB[0].toString(16)} (next 64 bytes):`);
console.log(`  ${B.slice(cB[0], cB[0]+64).toString('hex')}`);
