// dig-tail-diff1.js — diff two saves of the SAME campaign (different turn) over
// the tail region to find what's dynamic vs static. Reports changed 4KB blocks
// and, for the densest changed regions, byte-level deltas + nearby strings.
"use strict";
const fs = require("fs");
const A = process.argv[2];
const B = process.argv[3];
const START = parseInt(process.argv[4] || "0xf80000", 16);

const a = fs.readFileSync(A), b = fs.readFileSync(B);
console.log(`A=${A} (${a.length})`);
console.log(`B=${B} (${b.length})`);
console.log(`diff from 0x${START.toString(16)}`);

const N = Math.min(a.length, b.length);
const BLK = 4096;
const changed = [];
for (let base = START; base < N; base += BLK) {
  const end = Math.min(base + BLK, N);
  let d = 0;
  for (let i = base; i < end; i++) if (a[i] !== b[i]) d++;
  if (d > 0) changed.push({ base, d, len: end - base });
}
console.log(`\nchanged 4KB blocks: ${changed.length} of ${Math.ceil((N-START)/BLK)}`);

// Group consecutive changed blocks into runs
const runs = [];
let r = null;
for (const c of changed) {
  if (r && c.base === r.end) { r.end = c.base + c.len; r.d += c.d; }
  else { if (r) runs.push(r); r = { start: c.base, end: c.base + c.len, d: c.d }; }
}
if (r) runs.push(r);

console.log(`\n=== changed RUNS (merged) ===`);
for (const run of runs) {
  console.log(`  0x${run.start.toString(16)} .. 0x${run.end.toString(16)}  (${((run.end-run.start)/1024).toFixed(0)} KB, ${run.d} bytes differ)`);
}

// For the 8 biggest runs, sample what's near them: nearest ASCII string before.
function nearestStr(buf, off) {
  for (let i = off; i > off - 4096 && i > 0; i--) {
    // find a string ending near here
    let j = i, s = "";
    while (j < off + 64 && buf[j] >= 0x20 && buf[j] < 0x7f) { s += String.fromCharCode(buf[j]); j++; }
    if (s.length >= 6) return { off: i, s };
  }
  return null;
}
const big = [...runs].sort((x,y)=>(y.end-y.start)-(x.end-x.start)).slice(0,10);
console.log(`\n=== 10 biggest changed runs, with context ===`);
for (const run of big) {
  // first differing byte
  let first = -1;
  for (let i = run.start; i < run.end; i++) if (a[i] !== b[i]) { first = i; break; }
  const ns = nearestStr(a, run.start);
  console.log(`\n  RUN 0x${run.start.toString(16)}..0x${run.end.toString(16)} (${((run.end-run.start)/1024).toFixed(0)}KB, ${run.d} differ)`);
  if (ns) console.log(`    nearest str @0x${ns.off.toString(16)}: "${ns.s}"`);
  if (first >= 0) {
    const s = Math.max(run.start, first - 8);
    console.log(`    A @0x${first.toString(16)}: ${[...a.slice(s, s+40)].map(x=>x.toString(16).padStart(2,"0")).join(" ")}`);
    console.log(`    B @0x${first.toString(16)}: ${[...b.slice(s, s+40)].map(x=>x.toString(16).padStart(2,"0")).join(" ")}`);
  }
}
