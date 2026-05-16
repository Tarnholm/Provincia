// dig-tilegrid-fullscan4.js — Session 99/D
// Diff the tile-grid variable fields between two saves to see what changes.
// If F20/F28/F32 are static map-baked data, they should be byte-identical.
// If they're dynamic state (fog, visibility, AI movement cost), they'll diff.

const fs = require('fs');

const SAVE1 = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const SAVE2 = process.argv[3] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_2.2.sav';
const buf1 = fs.readFileSync(SAVE1);
const buf2 = fs.readFileSync(SAVE2);
console.log(`A: ${SAVE1.split(/[\\\/]/).pop()}  ${buf1.length} B`);
console.log(`B: ${SAVE2.split(/[\\\/]/).pop()}  ${buf2.length} B`);

const GRID_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;
const N = W * H;

// Diff bytes within the grid in both files
let diffs = 0;
const diffByByte = new Array(STRIDE).fill(0);
const diffCells = [];
for (let i = 0; i < N; i++) {
  const b1 = GRID_START + i * STRIDE;
  const b2 = GRID_START + i * STRIDE;
  if (b1 + STRIDE > buf1.length || b2 + STRIDE > buf2.length) break;
  let cellDiff = false;
  for (let j = 0; j < STRIDE; j++) {
    if (buf1[b1 + j] !== buf2[b2 + j]) {
      diffByByte[j]++;
      cellDiff = true;
    }
  }
  if (cellDiff) {
    diffs++;
    if (diffCells.length < 30) diffCells.push(i);
  }
}
console.log(`\nTotal cells differing: ${diffs} / ${N}`);
console.log('Per-byte diff count:');
for (let j = 0; j < STRIDE; j++) {
  if (diffByByte[j] > 0) {
    console.log(`  +${j}: ${diffByByte[j]} cells differ`);
  }
}

// Sample
if (diffCells.length > 0) {
  console.log('\nSample diff cells:');
  for (const i of diffCells.slice(0, 8)) {
    const col = i % W;
    const row = (i / W) | 0;
    const b1 = GRID_START + i * STRIDE;
    const b2 = GRID_START + i * STRIDE;
    const f20a = buf1.readInt32LE(b1+20), f20b = buf2.readInt32LE(b2+20);
    const f28a = buf1[b1+28], f28b = buf2[b2+28];
    const f32a = buf1.readInt32LE(b1+32), f32b = buf2.readInt32LE(b2+32);
    console.log(`  [r=${row},c=${col}] F20:${f20a}→${f20b}  F28:${f28a}→${f28b}  F32:${f32a}→${f32b}`);
  }
}
