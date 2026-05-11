// Session 32 step A: Identify the diplomatic matrix structure.
// 55,731 sig-matched records with stride 267, arranged in runs of 239.
// Find the START of the matrix, then compute row/col of the two flipped records.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));

const sig = Buffer.from([
  0x0a, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x00, 0x00,
  0x06, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
]);

const hits = [];
for (let i = 0; i < a.length - sig.length; i++) {
  if (a.compare(sig, 0, sig.length, i, i + sig.length) === 0) hits.push(i);
}
console.log(`Total hits: ${hits.length}, first=0x${hits[0].toString(16)}, last=0x${hits[hits.length-1].toString(16)}`);

// The 239-record-per-row pattern. Find boundaries.
const boundaries = [];
let runStart = hits[0];
let runLen = 1;
for (let i = 1; i < hits.length; i++) {
  const d = hits[i] - hits[i - 1];
  if (d === 267) { runLen++; continue; }
  boundaries.push({ start: runStart, count: runLen });
  runStart = hits[i];
  runLen = 1;
}
boundaries.push({ start: runStart, count: runLen });
console.log(`Total runs: ${boundaries.length}`);

// Filter to runs with count >= 200.
const longRuns = boundaries.filter(r => r.count >= 200);
console.log(`Long runs (>=200 entries): ${longRuns.length}`);
for (const r of longRuns.slice(0, 30)) {
  console.log(`  start=0x${r.start.toString(16)} count=${r.count}`);
}

// Now look at the FIRST few hits and the GAPS between them.
console.log(`\n=== First 20 hits ===`);
for (let i = 0; i < 20; i++) {
  const h = hits[i];
  const d = i > 0 ? hits[i] - hits[i - 1] : 0;
  console.log(`  [${i}] 0x${h.toString(16)} (delta=${d})`);
}

// Where is the matrix likely to start? Look at the gap before hits[0].
// And what's the first really-long run?
console.log(`\n=== First long run (>=200) ===`);
const firstLong = longRuns[0];
console.log(`First long run: start=0x${firstLong.start.toString(16)} count=${firstLong.count}`);
// Find the index of firstLong.start in hits.
const startIdx = hits.indexOf(firstLong.start);
console.log(`Index in hits: ${startIdx}`);
// What's before it?
if (startIdx > 0) {
  console.log(`Previous hit: 0x${hits[startIdx-1].toString(16)} (gap=${firstLong.start - hits[startIdx-1]})`);
}

// CRITICAL: the matrix may have many "non-default" rows/cells with different signatures.
// What if it's 239x239 and only ~55,731 cells are default? Then 57121 - 55731 = 1390 cells differ.
// Average ~5.8 non-default cells per row of 239. Plausible: each faction has a small set of relationships.

// Let's count cells per row by walking through and finding total record positions
// (default + non-default). Use stride=267 and find ALL records that look like
// records (i.e. have some structural marker).

// Strategy: the records use 267-byte stride. Find the most common starting offset modulo 267.
// Actually a simpler approach: find a different default pattern that might appear in war/peace
// state. Or, look for the section that contains the matrix and read its u32 size.

// Look at offsets just before hits[0] for a section header.
console.log(`\n=== Bytes around hits[0]=0x${hits[0].toString(16)} (looking back 256 bytes) ===`);
const h0 = hits[0];
const before = a.slice(Math.max(0, h0 - 256), h0);
let hex = '';
for (let k = 0; k < before.length; k += 16) {
  const off = h0 - 256 + k;
  const slice = before.slice(k, k + 16);
  hex += `  ${off.toString(16).padStart(8, '0')}: ${Array.from(slice).map(x => x.toString(16).padStart(2,'0')).join(' ')}\n`;
}
console.log(hex);
