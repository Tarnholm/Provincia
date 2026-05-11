// dig-gap8.js — try to find row-stride / 2D grid structure in the 36582-record array
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const REC_START = 0x633c50;
const STRIDE = 267;
const N = 36582;

// Hypothesis: this is a per-tile array, length = mapW * mapH.
// 36582 = 6 × 6097 = 2 × 18291 = 3 × 12194 = ...
// Try: any (W, H) such that W * H = 36582? primes are tricky.
console.log(`36582 factorization:`);
const factors = [];
for (let i = 1; i <= Math.sqrt(36582); i++) {
  if (36582 % i === 0) {
    factors.push([i, 36582/i]);
  }
}
factors.forEach(([a,b]) => console.log(`  ${a} × ${b} = ${a*b}`));

// But 36582 might be wrong — there are exactly 36644 records by stride (gap_len / 267)
// = 9783940 / 267 = 36644.1, so 36644 full records. Let me recount.
const REC_COUNT = Math.floor((0xf88637 - 0x633c50) / STRIDE);
console.log(`\nrecords that fit between 0x${(0x633c50).toString(16)}..0x${(0xf88637).toString(16)}: ${REC_COUNT}`);
// But after rec 36582 (first bad), the structure breaks. So REC_COUNT might overshoot.
// Try 36582:
console.log(`\n36582 div checks:`);
[150, 199, 200, 210, 220, 226, 239].forEach(w => {
  console.log(`  36582 / ${w} = ${(36582/w).toFixed(3)}  ${(36582 % w) === 0 ? '✓ exact' : `(rem ${36582%w})`}`);
});

// Or maybe the count is 200 × 183 = 36600?
console.log(`200 × 183 = ${200*183}, 188 × 195 = ${188*195}, 199 × 184 = ${199*184}`);

// Test if the LAST record before the tail bytes (rec 36581 = i=36581) makes sense.
// Let's actually find the boundary differently: at what record does the layout break?
// From dig-gap5, "first bad record at i=36582, addr=0xf84632" (the "default_set" tail).
// So records 0..36581 are uniform, and record 36582+ is no longer 267-stride.

// Actually — could it be 36582 = 199 × 184 + ?
console.log(`\n199 × 184 = ${199*184}, diff to 36582 = ${36582 - 199*184}`);

// Could 35699 ("default" records) be 200 × 178 = 35600 + 99? No, too off.
// Or maybe each region has variable # of tiles? RIS has ~199 regions in IC.
// Each region has ~120-200 tiles on average; 199 × 184 = 36616 ≈ 36582.
// So **per-region tile array** with ~184 tiles per region is plausible.

// Let me check if the "non-default" records (~883) cluster spatially.
// Look at the distribution of B@+28 ≠ 6 records (i.e., B = 0x36 or 0x37 = 54 or 55):
const nonDefault = [];
for (let i = 0; i < 36582; i++) {
  const a = buf.readUInt32LE(REC_START + i * STRIDE + 20);
  const b = buf.readUInt32LE(REC_START + i * STRIDE + 28);
  const c = buf.readUInt32LE(REC_START + i * STRIDE + 32);
  if (a !== 0xc8 || b !== 6 || c !== 0xc8) nonDefault.push({ i, a, b, c });
}
console.log(`\n${nonDefault.length} records are non-default`);
// Histogram of i mod various candidate periods
console.log(`\nnon-default indices mod period detection:`);
const periods = [120, 153, 180, 184, 200, 210, 226, 239];
for (const p of periods) {
  const buckets = new Array(p).fill(0);
  for (const r of nonDefault) buckets[r.i % p]++;
  // measure how "peaked" the distribution is
  const max = Math.max(...buckets);
  const mean = nonDefault.length / p;
  console.log(`  period ${p}: max bucket = ${max}, mean = ${mean.toFixed(1)}, max/mean = ${(max/mean).toFixed(2)}`);
}

// Print first 50 non-default records' i, a, b, c
console.log(`\nfirst 30 non-default records:`);
nonDefault.slice(0, 30).forEach(r => console.log(`  i=${r.i.toString().padStart(6)} A=${r.a.toString(16)} B=${r.b.toString(16)} C=${r.c.toString(16)}`));

// Compute spatial pattern: look at differences between consecutive non-default i's
const diffs = [];
for (let k = 1; k < nonDefault.length; k++) diffs.push(nonDefault[k].i - nonDefault[k-1].i);
const dCount = {};
for (const d of diffs) dCount[d] = (dCount[d]||0)+1;
const topDiffs = Object.entries(dCount).sort((a,b)=>b[1]-a[1]).slice(0, 15);
console.log(`\ntop diffs between consecutive non-default i's: ${topDiffs.map(([d,c])=>`${d}×${c}`).join(', ')}`);
