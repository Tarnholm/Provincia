// dig-diplo-HA.js — session 109 step HA
//
// Discovery: 219 marker zones, 780 distinct A values, all unique.
// Hypothesis: A is a relation-UUID. The total of 780 in save_10_fresh
// must match the number of pairs in RIS imperial's descr_strat
// diplomatic config + system-generated entries.
//
// Let's compute:
//   * what's the A range?
//   * is the set of A's contiguous (0..N)?
//   * if not contiguous, what's missing?
//
// Also, let's count by SAVE:
//   * does save_1.2 have the same 780 A's?
//   * does athens_t22e have MORE A's (because diplomatic events have happened)?
//
// Cross-validation: descr_strat.txt has the diplomatic config.
//
// Usage: node dig-diplo-HA.js
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "fixtures", "feral");

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}

function findValidMarkers(buf) {
  const markers = [];
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) markers.push(i);
  }
  return markers.filter((off) => {
    const count = buf.readUInt32LE(off + 4);
    if (count > 200 || count === 0) return false;
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      if (e + 16 > buf.length) return false;
      if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) return false;
    }
    return true;
  });
}

function collectEntries(buf, markers) {
  const entries = [];
  for (let zi = 0; zi < markers.length; zi++) {
    const off = markers[zi];
    const count = buf.readUInt32LE(off + 4);
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      entries.push({ zone: zi, markerOff: off,
        A: buf.readUInt32LE(e), B: buf.readUInt32LE(e + 4), C: buf.readUInt32LE(e + 8), D: buf.readUInt32LE(e + 12)
      });
    }
  }
  return entries;
}

const SAVES = ["save_10_fresh.sav", "ror_t1e.sav", "ror_t5.sav", "ror_t11e.sav", "athens_t21.sav", "athens_t22e.sav", "save_mp_before.sav", "save_1.2.sav"];

for (const name of SAVES) {
  const buf = fs.readFileSync(path.join(root, name));
  const valid = findValidMarkers(buf);
  const entries = collectEntries(buf, valid);
  const A = [...new Set(entries.map((e) => e.A))].sort((a, b) => a - b);
  const distinctB = new Set(entries.map((e) => e.B));
  const distinctC = new Set(entries.map((e) => e.C));
  const aMin = A[0];
  const aMax = A[A.length - 1];
  console.log(`${name.padEnd(22)} | markers=${valid.length.toString().padStart(3)} | entries=${entries.length.toString().padStart(4)} | distinct A=${A.length.toString().padStart(4)} (range ${aMin}..${aMax}) | distinct B=${[...distinctB].sort((a,b)=>a-b).join(",")} | distinct C=${[...distinctC].sort((a,b)=>a-b).join(",")}`);
}

// For save_10_fresh, get the SORTED A values and find gaps
const buf = fs.readFileSync(path.join(root, "save_10_fresh.sav"));
const valid = findValidMarkers(buf);
const entries = collectEntries(buf, valid);
const A = [...new Set(entries.map((e) => e.A))].sort((a, b) => a - b);
console.log(`\n=== save_10_fresh A range & gaps ===`);
console.log(`  count: ${A.length}, range: ${A[0]}..${A[A.length - 1]}`);
const gaps = [];
for (let i = 1; i < A.length; i++) {
  if (A[i] - A[i - 1] > 1) gaps.push({ from: A[i - 1], to: A[i], gap: A[i] - A[i - 1] });
}
console.log(`  gaps in A (>=1): ${gaps.length}, max gap = ${Math.max(...gaps.map((g) => g.gap))}`);
console.log(`  first 5 gaps:`, gaps.slice(0, 5));
console.log(`  last 5 gaps:`, gaps.slice(-5));

// Special: across all savs, compute B/C global distribution
console.log(`\n=== Across save_10_fresh: B/C joint distribution ===`);
const bc = {};
for (const e of entries) {
  const key = `B=${e.B},C=${e.C}`;
  bc[key] = (bc[key] || 0) + 1;
}
Object.entries(bc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// For pairs of saves, show which A values appear in only ONE of them
const buf2 = fs.readFileSync(path.join(root, "athens_t22e.sav"));
const v2 = findValidMarkers(buf2);
const e2 = collectEntries(buf2, v2);
const A2 = new Set(e2.map((e) => e.A));
const A1 = new Set(entries.map((e) => e.A));
const onlyIn1 = [...A1].filter((a) => !A2.has(a));
const onlyIn2 = [...A2].filter((a) => !A1.has(a));
console.log(`\n=== save_10_fresh vs athens_t22e A diff ===`);
console.log(`  save_10_fresh only: ${onlyIn1.length}`);
console.log(`  athens_t22e only: ${onlyIn2.length}`);
console.log(`  common: ${A1.size - onlyIn1.length}`);

// For common A's, do they have the same B/C? Check a few examples.
const a1Map = new Map(entries.map((e) => [e.A, e]));
const a2Map = new Map(e2.map((e) => [e.A, e]));
let cmpSame = 0, cmpDiff = 0;
const diffExamples = [];
for (const a of A1) {
  if (!A2.has(a)) continue;
  const e1 = a1Map.get(a);
  const ee2 = a2Map.get(a);
  if (e1.B === ee2.B && e1.C === ee2.C) cmpSame++;
  else { cmpDiff++; if (diffExamples.length < 10) diffExamples.push({ A: a, t0: { B: e1.B, C: e1.C }, t22: { B: ee2.B, C: ee2.C } }); }
}
console.log(`  common A B/C unchanged: ${cmpSame}`);
console.log(`  common A B/C changed: ${cmpDiff}`);
diffExamples.forEach((e) => console.log(`    A=${e.A}: T0 (B=${e.t0.B},C=${e.t0.C}) → T22 (B=${e.t22.B},C=${e.t22.C})`));
