// dig-tilegrid-fullscan.js — Session 99/A
// Scan ALL 267 bytes of every tile-grid record (not just +0..+99) to find any
// variable fields beyond byte 100. Session 22's "+100..+266 = 171 bytes of
// zeros" claim was made from a 100-byte window; this confirms or refutes that
// the full second half of the record is constant.
//
// Run on save_1.2.sav (RIS imperial), then dump per-position distinct-count.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

// Tile-grid: 0xf8fd2 .. 0xf84632 (matches cover.js claim header)
const GRID_START = 0xf8fd2;
const STRIDE = 267;
// Total bytes in claim
const GRID_BYTES = 240 * 238 * 267;
const N = 240 * 238; // 57120
console.log(`grid start=0x${GRID_START.toString(16)} N=${N} stride=${STRIDE}`);
console.log(`grid end=0x${(GRID_START + GRID_BYTES).toString(16)}`);

// Per-byte distinct-value count
const distinct = new Array(STRIDE).fill(null).map(() => new Set());
const histo = new Array(STRIDE).fill(null).map(() => new Map());

for (let i = 0; i < N; i++) {
  const recBase = GRID_START + i * STRIDE;
  for (let j = 0; j < STRIDE; j++) {
    const b = buf[recBase + j];
    distinct[j].add(b);
    histo[j].set(b, (histo[j].get(b) || 0) + 1);
  }
}

console.log('\n# Per-byte distinct-value count over 240×238 = 57,120 cells:');
console.log('pos  distinct  most-common-value  count  pct  next');
for (let j = 0; j < STRIDE; j++) {
  const d = distinct[j].size;
  // Most common
  let topV = null, topC = 0, secV = null, secC = 0;
  for (const [v, c] of histo[j]) {
    if (c > topC) { secV = topV; secC = topC; topV = v; topC = c; }
    else if (c > secC) { secV = v; secC = c; }
  }
  const pct = (topC / N * 100).toFixed(1);
  if (d > 1) {
    const secStr = secV !== null ? `0x${secV.toString(16)}×${secC}` : '-';
    console.log(`+${j.toString().padStart(3)}  ${d.toString().padStart(8)}  0x${topV.toString(16).padStart(2,'0')}=${topV.toString().padStart(3)}    ${topC.toString().padStart(6)}  ${pct.padStart(5)}%  ${secStr}`);
  }
}

// Variable byte positions only
console.log('\n# Variable-byte cluster summary:');
let runStart = -1;
const runs = [];
for (let j = 0; j <= STRIDE; j++) {
  const v = j < STRIDE && distinct[j].size > 1;
  if (v && runStart < 0) runStart = j;
  else if (!v && runStart >= 0) {
    runs.push([runStart, j - 1, j - runStart]);
    runStart = -1;
  }
}
for (const [s, e, l] of runs) {
  console.log(`  +${s}..+${e}  (${l} bytes)`);
}
