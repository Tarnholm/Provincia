// Find which bytes within the matrix differ.
const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

const stride = 267;
const matStart = 0xf8fd2;
const N = 239;
const matEnd = matStart + N * N * stride;

console.log(`Matrix bytes that differ between A and B:`);
for (let i = matStart; i < matEnd; i++) {
  if (a[i] !== b[i]) {
    const cellIdx = Math.floor((i - matStart) / stride);
    const offInCell = (i - matStart) % stride;
    const r = Math.floor(cellIdx / N);
    const c = cellIdx % N;
    console.log(`  off=0x${i.toString(16)} cell=[${r}][${c}] offInCell=${offInCell} A=0x${a[i].toString(16)} B=0x${b[i].toString(16)}`);
  }
}
