// dig-tail-tilegrid12.js — Reinterpret. The format is u16 cell stream where:
//   0x00ff = "1 empty cell"
//   0xVV00 + multiple byte stream after = "a row of populated cells"
//
// Wait, the cells we decoded showed:
//   cells[0..2] = 0xff00 0xff00 0xff00     -- (00 ff each, so u16 = 0xff00, but...)
//
// Hmm, actually the bytes are "00 ff 00 ff 00 ff 00 e4 02 01 03 09 02 01 00 02 02 01 03 07 02 01 00 ff 00 ff 00 ff"
//
// Read as u16 LE (little-endian):
//   buf[0]=0x00, buf[1]=0xff → u16 = 0xff00 (low=00, high=ff → 0xff*256+0x00 = 65280)
//   buf[2]=0x00, buf[3]=0xff → u16 = 0xff00
//   buf[4]=0x00, buf[5]=0xff → u16 = 0xff00
//   buf[6]=0x00, buf[7]=0xe4 → u16 = 0xe400 = 58368
//   buf[8]=0x02, buf[9]=0x01 → u16 = 0x0102 = 258
//   buf[10]=0x03, buf[11]=0x09 → u16 = 0x0903 = 2307
//   ...
//
// So as cells: 0xff00, 0xff00, 0xff00, 0xe400, 0x0102, 0x0903, ...
//
// What if cells are interpreted as packed (high_byte: count, low_byte: value)?
// Then 0xff00 means "count 0xff, value 0x00" = 255 empty cells, OR "count 0, value 0xff" — no, the
// pattern wouldn't work.
//
// Let me try: cell.low = value, cell.high = count
//   0xff00 → value=0, count=255 (255 background cells)
//   0xe400 → value=0, count=228 (228 background cells)
//   0x0102 → value=2, count=1 (1 cell of value 2)
//   0x0903 → value=3, count=9 (9 cells of value 3)
//   0x0102 → value=2, count=1
//   0x0200 → value=0, count=2 (2 background cells)
//   0x0102 → value=2, count=1
//   0x0703 → value=3, count=7
//   0x0102 → value=2, count=1
//   0xff00 → value=0, count=255
//   0xff00 → value=0, count=255
//   0xff00 → value=0, count=255
//
// THIS WORKS! Each u16 cell is a RLE pair: (low=value, high=count).
// 0xff00 = 255 cells of value 0 (background).
// 0xe400 = 228 cells of value 0 — a "long jump".
//
// Let me verify and count the total cells.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(ROME10);

const PAYLOAD_START = 0x1f4835f;
const PAYLOAD_END = 0x1f4a463;

let totalCells = 0;
let rleCount = 0;
const valueHist = new Map();
const sequence = [];
for (let p = PAYLOAD_START; p < PAYLOAD_END - 1; p += 2) {
  const cell = buf.readUInt16LE(p);
  const value = cell & 0xff;       // low byte = value
  const count = (cell >> 8) & 0xff; // high byte = count
  totalCells += count;
  rleCount++;
  valueHist.set(value, (valueHist.get(value) || 0) + count);
  if (sequence.length < 100) sequence.push({ value, count });
}
console.log(`RLE u16 cells: ${rleCount}`);
console.log(`Total expanded cells: ${totalCells}`);
console.log(`Expected if 1020x700 = ${1020 * 700} = ${totalCells === 1020 * 700 ? "MATCH ✓" : "MISMATCH"}`);
console.log(`Value distribution (expanded):`);
const valueSorted = [...valueHist.entries()].sort((a, b) => b[1] - a[1]);
for (const [v, c] of valueSorted.slice(0, 20)) {
  console.log(`  value=${v}: ${c} cells (${(c / totalCells * 100).toFixed(2)}%)`);
}

console.log(`\nFirst 40 RLE pairs:`);
for (let i = 0; i < 40 && i < sequence.length; i++) {
  process.stdout.write(`(v=${sequence[i].value},c=${sequence[i].count}) `);
  if (i % 8 === 7) console.log();
}
console.log();

// Now: if this is 714,000 cells of a 1020x700 grid (W=1020, H=700), then:
// Decode the whole mask and verify the row-by-row structure. Identify which cells are non-zero.

// First, expand to a full bitmap
const W = 1020;
const H = 700;
const mask = new Uint8Array(W * H);
let cursor = 0;
for (let p = PAYLOAD_START; p < PAYLOAD_END - 1; p += 2) {
  const cell = buf.readUInt16LE(p);
  const value = cell & 0xff;
  const count = (cell >> 8) & 0xff;
  for (let k = 0; k < count; k++) {
    if (cursor < mask.length) mask[cursor++] = value;
  }
}
console.log(`\nDecoded mask cells: ${cursor} (expected ${W * H} = ${W * H})`);

// Count non-zero cells
let nonZero = 0;
let bbox = { minX: W, maxX: 0, minY: H, maxY: 0 };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (mask[y * W + x] !== 0) {
      nonZero++;
      if (x < bbox.minX) bbox.minX = x;
      if (x > bbox.maxX) bbox.maxX = x;
      if (y < bbox.minY) bbox.minY = y;
      if (y > bbox.maxY) bbox.maxY = y;
    }
  }
}
console.log(`Non-zero cells: ${nonZero}`);
console.log(`Bounding box: X=[${bbox.minX}..${bbox.maxX}] Y=[${bbox.minY}..${bbox.maxY}]`);

// Compute centroid
let sumX = 0, sumY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (mask[y * W + x] !== 0) { sumX += x; sumY += y; }
  }
}
console.log(`Centroid (cell coords): (${(sumX / nonZero).toFixed(1)}, ${(sumY / nonZero).toFixed(1)})`);

// Print a downsampled visualization (one char per 17 cols x 10 rows)
console.log(`\nMask visualization (one char per 17 cols × 10 rows):`);
for (let y = 0; y < H; y += 10) {
  let line = "";
  for (let x = 0; x < W; x += 17) {
    // Average value in 17x10 region
    let count = 0;
    let maxV = 0;
    for (let dy = 0; dy < 10 && y + dy < H; dy++) {
      for (let dx = 0; dx < 17 && x + dx < W; dx++) {
        const v = mask[(y + dy) * W + (x + dx)];
        if (v !== 0) count++;
        if (v > maxV) maxV = v;
      }
    }
    line += count === 0 ? "." : (maxV >= 5 ? "#" : maxV >= 3 ? "o" : maxV >= 1 ? "-" : ".");
  }
  console.log(`  y=${y.toString().padStart(3)}: ${line}`);
}
