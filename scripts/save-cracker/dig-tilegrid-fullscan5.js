// dig-tilegrid-fullscan5.js — Session 99/E
// Find tile-grid offset dynamically in each save and diff properly.

const fs = require('fs');

const SAVE1 = process.argv[2];
const SAVE2 = process.argv[3];
const buf1 = fs.readFileSync(SAVE1);
const buf2 = fs.readFileSync(SAVE2);

// Tile-grid magic: 05 00 00 00 00*8 0a 00 00 00 c8 00 00 00 (= +0 const=5, +12 const=10, +16 const=200)
const MAGIC = Buffer.from([0x05,0x00,0x00,0x00, 0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00, 0x0a,0x00,0x00,0x00, 0xc8,0x00,0x00,0x00]);
const off1 = buf1.indexOf(MAGIC);
const off2 = buf2.indexOf(MAGIC);
console.log(`A=${SAVE1.split(/[\\\/]/).pop()}  grid @0x${off1.toString(16)}`);
console.log(`B=${SAVE2.split(/[\\\/]/).pop()}  grid @0x${off2.toString(16)}`);

const STRIDE = 267;
const W = 240, H = 238;
const N = W * H;

// Diff
let diffs = 0;
const diffByByte = new Array(STRIDE).fill(0);
const diffCells = [];
for (let i = 0; i < N; i++) {
  const b1 = off1 + i * STRIDE;
  const b2 = off2 + i * STRIDE;
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
  if (diffByByte[j] > 0) console.log(`  +${j}: ${diffByByte[j]} cells differ`);
}
