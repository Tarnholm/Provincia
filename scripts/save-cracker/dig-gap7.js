// dig-gap7.js — characterize the 267-byte record's variable u32 fields + the tail region.
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const REC_START = 0x633c50;
const STRIDE = 267;
const N = 36582;

// Now distill variable fields. From dig-gap6:
//  byte 20-23: u32 at +20  (0xc8 / 0x258 / 0x0)  — type-A 16-bit-fit field
//  byte 24-27: const 0x02
//  byte 28-31: u32 at +28  (0x6 / 0x36 / 0x37)   — type-B small enum
//  byte 32-35: u32 at +32  (0xc8 / 0x258 / 0x0 / 0xf6 / 0x190)  — type-C

// Q: which combinations of (A, B, C) appear?
const triples = new Map();
for (let i = 0; i < N; i++) {
  const rs = REC_START + i * STRIDE;
  const a = buf.readUInt32LE(rs + 20);
  const b = buf.readUInt32LE(rs + 28);
  const c = buf.readUInt32LE(rs + 32);
  const k = `${a.toString(16)}|${b.toString(16)}|${c.toString(16)}`;
  if (!triples.has(k)) triples.set(k, { count: 0, firstIdx: i });
  triples.get(k).count++;
}
console.log(`distinct (A@+20, B@+28, C@+32) triples: ${triples.size}`);
[...triples.entries()].sort((a,b)=>b[1].count-a[1].count).forEach(([k,v]) => {
  console.log(`  count=${v.count.toString().padStart(6)} idx0=${v.firstIdx.toString().padStart(6)}  triple=(${k})`);
});

// Q: do A, B, C have spatial structure? (e.g., region IDs that cluster)
// Print idx ranges where B = 0x36 (54)
console.log(`\n=== B@+28 = 0x36 (54): index ranges ===`);
let prev = -2, start = -1, ranges = [];
for (let i = 0; i < N; i++) {
  const b = buf.readUInt32LE(REC_START + i * STRIDE + 28);
  if (b === 0x36) {
    if (i !== prev + 1) {
      if (start >= 0) ranges.push([start, prev]);
      start = i;
    }
    prev = i;
  }
}
if (start >= 0) ranges.push([start, prev]);
console.log(`${ranges.length} contiguous ranges where B = 0x36`);
ranges.slice(0, 25).forEach(([s,e]) => console.log(`  i=${s}..${e} (len=${e-s+1})`));

// Q: same for B = 0x37
console.log(`\n=== B@+28 = 0x37 (55): index ranges ===`);
prev = -2; start = -1; ranges = [];
for (let i = 0; i < N; i++) {
  const b = buf.readUInt32LE(REC_START + i * STRIDE + 28);
  if (b === 0x37) {
    if (i !== prev + 1) {
      if (start >= 0) ranges.push([start, prev]);
      start = i;
    }
    prev = i;
  }
}
if (start >= 0) ranges.push([start, prev]);
console.log(`${ranges.length} contiguous ranges where B = 0x37`);
ranges.slice(0, 25).forEach(([s,e]) => console.log(`  i=${s}..${e} (len=${e-s+1})`));

// Q: row-stride detection — if records are arranged in rows of length L, then field A
// would change at row boundaries. Try common map widths.
console.log(`\n=== row-stride detection: find L such that A@+20 changes mostly at multiples of L ===`);
const aVals = new Uint32Array(N);
for (let i = 0; i < N; i++) aVals[i] = buf.readUInt32LE(REC_START + i * STRIDE + 20);
// Find positions where A changes
const changes = [];
for (let i = 1; i < N; i++) if (aVals[i] !== aVals[i-1]) changes.push(i);
console.log(`A changes at ${changes.length} indices`);
// Histogram of change-stride
const sdiff = {};
for (let i = 1; i < changes.length; i++) {
  const d = changes[i] - changes[i-1];
  sdiff[d] = (sdiff[d] || 0) + 1;
}
const topD = Object.entries(sdiff).sort((a,b)=>b[1]-a[1]).slice(0, 12);
console.log(`top change-strides (i.e. run lengths of constant A): ${topD.map(([d,c])=>`${d}×${c}`).join(', ')}`);

// Q: if first ~10000 records have A = 0xc8 and others vary, maybe records are sorted by region/owner?
// print summary of A by 1000-block
console.log(`\n=== A@+20 summary by 1000-record block ===`);
for (let b = 0; b < N; b += 1000) {
  const vals = new Map();
  for (let i = b; i < Math.min(b+1000, N); i++) vals.set(aVals[i], (vals.get(aVals[i])||0)+1);
  const top = [...vals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([v,c])=>`${v}×${c}`).join(', ');
  console.log(`  block ${b}..${Math.min(b+999, N-1)}: ${top}`);
}

// === Tail region ===
const TAIL_START = 0xf84641;  // approximate start of building strings
const TAIL_END = 0xf88637;
console.log(`\n=== tail region ${(TAIL_END-TAIL_START)} bytes  (0x${TAIL_START.toString(16)}..0x${TAIL_END.toString(16)}) ===`);
// extract all ASCII strings of length >= 4
const re = /[\x20-\x7e]{4,}/g;
const tail = buf.slice(TAIL_START, TAIL_END);
const tailStr = Array.from(tail).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '\x01').join('');
const found = [];
let m;
while ((m = re.exec(tailStr)) !== null) found.push({ pos: TAIL_START + m.index, s: m[0] });
console.log(`found ${found.length} ASCII runs of >=4 chars in tail`);
console.log(`first 60 strings:`);
found.slice(0, 60).forEach(f => console.log(`  0x${f.pos.toString(16)}  "${f.s}"`));
console.log(`...`);
console.log(`last 20 strings:`);
found.slice(-20).forEach(f => console.log(`  0x${f.pos.toString(16)}  "${f.s}"`));
console.log(`\nunique string count: ${new Set(found.map(f=>f.s)).size}`);
