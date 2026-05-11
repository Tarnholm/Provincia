// Final sanity check: walk the matrix and confirm only [0][156] and [156][0] differ.
const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

const stride = 267;
const matStart = 0xf8fd2;
const N = 239;

// Full byte-level scan of the matrix.
const matEnd = matStart + N * N * stride;
console.log(`Matrix: 0x${matStart.toString(16)}..0x${matEnd.toString(16)} (${matEnd - matStart} bytes, ${N*N} cells)`);

let diffBytes = 0;
const cellsWithDiff = new Set();
for (let i = matStart; i < matEnd; i++) {
  if (a[i] !== b[i]) {
    diffBytes++;
    const cellIdx = Math.floor((i - matStart) / stride);
    cellsWithDiff.add(cellIdx);
  }
}
console.log(`Total bytes differing in matrix: ${diffBytes}`);
console.log(`Cells with at least one byte diff: ${cellsWithDiff.size}`);
for (const c of cellsWithDiff) {
  const r = Math.floor(c / N);
  const col = c % N;
  console.log(`  cell idx=${c} -> [r=${r}][c=${col}]`);
}

// Also confirm: the OTHER -10 byte location is OUTSIDE the matrix.
console.log(`\nMatrix end: 0x${matEnd.toString(16)}`);
console.log(`Move-trail region: 0x1f1dc00..0x1f1de00 (outside matrix? ${0x1f1dc00 >= matEnd})`);
