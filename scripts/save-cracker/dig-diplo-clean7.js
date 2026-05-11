// Session 32 step 7: characterize the diplomatic record array structure.
// We found ~55,731 records with signature `00 00 00 00 0a 00 00 00 c8 00 00 00 c8 00 00 00 02 00 00 00 06 00 00 00 c8 00 00 00`
// in BOTH files (so this is the default-state pattern).
// The ENUM byte (4 bytes before sig) is at offset sig-4.
// Two records flip A=5 -> B=1 at 0x103286 and 0xa775de.
//
// Hypothesis: 239x239 = 57121 records minus self-pairs = 56882. Total record stride?
// Let's compute stride from first two record offsets.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

// Find ALL records by signature, then check stride.
const sig = Buffer.from([
  0x0a, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x00, 0x00,
  0x06, 0x00, 0x00, 0x00,
  0xc8, 0x00, 0x00, 0x00,
]);

// Search for sig in A and gather positions.
const hits = [];
for (let i = 0; i < a.length - sig.length; i++) {
  if (a.compare(sig, 0, sig.length, i, i + sig.length) === 0) hits.push(i);
}
console.log(`Total sig hits in A: ${hits.length}`);

// Stride analysis.
const strides = {};
for (let i = 1; i < Math.min(hits.length, 1000); i++) {
  const d = hits[i] - hits[i - 1];
  strides[d] = (strides[d] || 0) + 1;
}
console.log(`Stride histogram (first 1000 records):`);
const top = Object.entries(strides).sort((x, y) => y[1] - x[1]).slice(0, 20);
for (const [d, c] of top) console.log(`  stride=${d} (0x${parseInt(d).toString(16)}): ${c}`);

// Find boundaries — runs of consecutive uniform stride.
console.log(`\nLooking for boundaries (stride changes)...`);
const boundaries = [];
let runStart = hits[0];
let runStride = hits[1] - hits[0];
let runLen = 2;
for (let i = 2; i < hits.length; i++) {
  const d = hits[i] - hits[i - 1];
  if (d === runStride) { runLen++; continue; }
  boundaries.push({ start: runStart, end: hits[i - 1], stride: runStride, count: runLen });
  runStart = hits[i - 1];
  runStride = d;
  runLen = 2;
}
boundaries.push({ start: runStart, end: hits[hits.length - 1], stride: runStride, count: runLen });
console.log(`Found ${boundaries.length} stride-runs (top 30 by count):`);
for (const r of boundaries.sort((x, y) => y.count - x.count).slice(0, 30)) {
  console.log(`  start=0x${r.start.toString(16)} stride=${r.stride} (0x${r.stride.toString(16)}) count=${r.count}`);
}

// Find the two flipped enum locations in A:
console.log(`\n=== Position of the FLIPPED records in A's hit list ===`);
const flippedSigStarts = [0x103286 + 4, 0xa775de + 4]; // sig starts 4 bytes AFTER enum offset
// Actually re-check: enum at 0x103286, sig at 0x10328a... let me recompute.
// In dig-diplo-clean5.js, AREA 1: byte at 0x103286 went 05->01.
// Around it: at 0x103290 we have "00 00 0a 00 00 00 c8 00 00 00..." -- that means sig starts at 0x103292.
// Wait. Let me recheck:
//   0x103286: 05 00 00 00 (A) or 01 00 00 00 (B) -- this is the enum u32 at +0x06 from row start (0x103280)
//   0x10328a: 00 00 00 00 -- u32=0 at +0x0a
//   0x10328e: 00 00 00 00 -- hmm. Actually look at line: "00103280: 00 00 00 00 00 00 05 00 00 00 00 00 00 00 00 00"
//   So at 0x103286 starts the u32 enum (=0x00000005). At 0x10328a starts another u32 (=0).
//   At 0x103290 line we have "00 00 0a 00 00 00 c8 00 00 00 c8 00 00 00 02 00"
//   So sig (starting with 0a 00 00 00) starts at 0x103292.
// Confirmed: enum at 0x103286, sig at 0x103292 (8 bytes later, not 4).
console.log(`AREA 1 enum=0x103286, sig should be at 0x103292`);
console.log(`AREA 2 enum=0xa775de, sig should be at 0xa775ea`);
const f1 = hits.indexOf(0x103292);
const f2 = hits.indexOf(0xa775ea);
console.log(`flip1 index in hits: ${f1}`);
console.log(`flip2 index in hits: ${f2}`);
if (f1 >= 0) {
  console.log(`Around flip1: hits[${f1-2}..${f1+2}] = ${[-2,-1,0,1,2].map(k => '0x' + hits[f1+k]?.toString(16)).join(' ')}`);
}
if (f2 >= 0) {
  console.log(`Around flip2: hits[${f2-2}..${f2+2}] = ${[-2,-1,0,1,2].map(k => '0x' + hits[f2+k]?.toString(16)).join(' ')}`);
}
