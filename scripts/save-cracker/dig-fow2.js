// dig-fow2.js
// Inspect the 4 bytes that changed in the FoW toggle.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_9.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// The 3 affected ranges
const ranges = [
  { lo: 0x43f0, hi: 0x4510 },
  { lo: 0x44d8, hi: 0x4500 },
  { lo: 0x02110dd0, hi: 0x02110e08 },
];

for (const r of ranges) {
  console.log(`\n=== Range ${hex(r.lo)}..${hex(r.hi)} ===`);
  console.log(`A: ${A.subarray(r.lo, r.hi).toString('hex')}`);
  console.log(`B: ${B.subarray(r.lo, r.hi).toString('hex')}`);
  // Mark per-byte diffs
  let mark = '';
  for (let i = r.lo; i < r.hi; i++) mark += (A[i] === B[i]) ? '.' : 'X';
  console.log(`D: ${mark}`);
}

// Cross-reference with previous session findings: 0x43f8 = "RNG counter" per session 32
// 0x455c = RNG seed (4 bytes — at 0x455c..0x4560)
// 0x44e2 — new spot
// 0x02110de5 — Lua state footer area

// Read these as u32 (LE) for interpretation
function dumpU32(buf, off) {
  return buf.readUInt32LE(off).toString().padStart(10);
}

console.log('\n=== Specific u32 reads ===');
for (const off of [0x43f4, 0x43f8, 0x43fc, 0x44e0, 0x44e2, 0x455c]) {
  const a = A.readUInt32LE(off);
  const b = B.readUInt32LE(off);
  console.log(`u32 @ ${hex(off)}: A=${a} B=${b} ${a!==b?'CHANGED':''}`);
}

// Lua state area
console.log('\n=== Lua state context (32 bytes around 0x02110de5) ===');
const lo = 0x02110dd0;
const hi = 0x02110e08;
const a16 = A.subarray(lo, hi).toString('hex');
const b16 = B.subarray(lo, hi).toString('hex');
console.log(`A: ${a16}`);
console.log(`B: ${b16}`);

// ASCII for the lua area
function ascii(buf, lo, hi) {
  let s = '';
  for (let i = lo; i < hi; i++) {
    const c = buf[i];
    s += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
  }
  return s;
}
console.log(`A ascii: ${ascii(A, lo, hi)}`);
console.log(`B ascii: ${ascii(B, lo, hi)}`);

// Search wider context for ASCII tokens
function asciiAround(buf, off, radius = 256) {
  const lo = Math.max(0, off - radius);
  const hi = Math.min(buf.length, off + radius);
  let runs = [];
  let cur = null;
  for (let i = lo; i < hi; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) {
      if (cur) cur.s += String.fromCharCode(c);
      else cur = { start: i, s: String.fromCharCode(c) };
    } else {
      if (cur && cur.s.length >= 4) runs.push(cur);
      cur = null;
    }
  }
  if (cur && cur.s.length >= 4) runs.push(cur);
  return runs;
}
console.log('\nASCII tokens within ±256 of 0x02110de5 (from A):');
for (const r of asciiAround(A, 0x02110de5, 256)) {
  console.log(`  ${hex(r.start)}: "${r.s}"`);
}
