// dig-tilegrid-fullscan2.js — Session 99/B
// Decode the +20/+28/+32 variable fields as u32 LE and map their values to
// 2-D positions on the 240×238 grid.  Identify exactly what spatial signal
// each field carries.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

const GRID_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;
const N = W * H;

const F20 = new Int32Array(N);
const F28 = new Uint8Array(N);
const F32 = new Int32Array(N);

for (let i = 0; i < N; i++) {
  const b = GRID_START + i * STRIDE;
  F20[i] = buf.readInt32LE(b + 20);
  F28[i] = buf[b + 28];
  F32[i] = buf.readInt32LE(b + 32);
}

function summarizeField(arr, name) {
  const histo = new Map();
  for (const v of arr) histo.set(v, (histo.get(v) || 0) + 1);
  const sorted = [...histo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\n${name}: ${histo.size} distinct values`);
  for (const [v, c] of sorted) {
    console.log(`  ${v} (0x${(v >>> 0).toString(16)}): ${c}`);
  }
}
summarizeField(F20, 'F20 (u32 at +20)');
summarizeField(F28, 'F28 (u8 at +28)');
summarizeField(F32, 'F32 (u32 at +32)');

// Find the row/col positions of non-default values
function mapNonDefault(arr, defaultVal, name) {
  const points = [];
  for (let i = 0; i < N; i++) {
    if (arr[i] !== defaultVal) {
      const col = i % W;
      const row = (i / W) | 0;
      points.push([row, col, arr[i]]);
    }
  }
  console.log(`\n${name}: ${points.length} non-default cells`);
  if (points.length > 0) {
    const colHist = new Map();
    const rowHist = new Map();
    for (const [r, c] of points) {
      colHist.set(c, (colHist.get(c) || 0) + 1);
      rowHist.set(r, (rowHist.get(r) || 0) + 1);
    }
    // Top columns
    const tc = [...colHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const tr = [...rowHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`  top cols: ${tc.map(([c, n]) => `${c}×${n}`).join(', ')}`);
    console.log(`  top rows: ${tr.map(([r, n]) => `${r}×${n}`).join(', ')}`);
    // Sample 12
    console.log(`  samples: ${points.slice(0, 12).map(p => `[r${p[0]},c${p[1]}]=${p[2]}`).join('  ')}`);
  }
}

mapNonDefault(F20, 200, 'F20≠200');
mapNonDefault(F28, 6, 'F28≠6');
mapNonDefault(F32, 200, 'F32≠200');

// Cross-check: are F20 and F32 always equal? (Both have default 200, range 0..600)
let bothEqual = 0, eitherDiff = 0, only20 = 0, only32 = 0;
for (let i = 0; i < N; i++) {
  const d20 = F20[i] !== 200, d32 = F32[i] !== 200;
  if (d20 && d32) { eitherDiff++; if (F20[i] === F32[i]) bothEqual++; }
  else if (d20) only20++;
  else if (d32) only32++;
}
console.log(`\nF20/F32 correlation:`);
console.log(`  both non-default: ${eitherDiff} (of these, F20==F32 in ${bothEqual})`);
console.log(`  only F20 non-default: ${only20}`);
console.log(`  only F32 non-default: ${only32}`);

// Show F32 values that are not 200 alongside F20 in same cells
console.log(`\nNon-default rows side-by-side (first 20 where F20!=200 OR F32!=200 OR F28!=6):`);
let n = 0;
for (let i = 0; i < N && n < 20; i++) {
  if (F20[i] !== 200 || F32[i] !== 200 || F28[i] !== 6) {
    const col = i % W;
    const row = (i / W) | 0;
    console.log(`  [${row.toString().padStart(3)},${col.toString().padStart(3)}]  F20=${F20[i].toString().padStart(5)}  F28=${F28[i].toString().padStart(3)}  F32=${F32[i].toString().padStart(5)}`);
    n++;
  }
}

// F28 distribution by row (just the non-default ones)
console.log(`\nF28≠6 row distribution:`);
const f28RowHist = new Map();
for (let i = 0; i < N; i++) {
  if (F28[i] !== 6) {
    const row = (i / W) | 0;
    f28RowHist.set(row, (f28RowHist.get(row) || 0) + 1);
  }
}
const f28RowSorted = [...f28RowHist.entries()].sort((a, b) => a[0] - b[0]);
console.log(`  rows with F28≠6 count: ${f28RowSorted.map(([r, n]) => `r${r}:${n}`).slice(0, 30).join(' ')}`);
