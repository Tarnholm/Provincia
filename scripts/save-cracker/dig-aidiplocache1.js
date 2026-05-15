// dig-aidiplocache1.js — session 62.
// Goal: characterise the "gap #6 family" — large unclaimed blobs in the
// settlement zone with a 16-byte random-hash signature, no portraits, no
// army-unit tail, <5% 0xFF.
//
// Session 61 named the 5 largest survivors:
//   0x01f1a697..0x01f1fc14  21,885 B
//   0x018be452..0x018c1c1d  14,283 B
//   0x01d000d6..0x01d0373b  13,925 B
//   0x01cf5669..0x01cf8cbb  13,906 B
//   0x01a9372d..0x01a96d0e  13,793 B
//
// Plan:
//   1. Run cover.js's claim logic mentally — already know the 5 above. Use them.
//   2. Dump first 256 B + last 256 B of each.
//   3. Cross-compare first 64 B for structural alignment (u32 patterns).
//   4. Sliding-window full hex+ascii of first 1 KB of the largest to scout.
//   5. Look for known IDs (faction IDs 0..30, region IDs, settlement names).

"use strict";

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE);

const TARGETS = [
  { start: 0x01f1a697, end: 0x01f1fc14, label: "T1-21885" },
  { start: 0x018be452, end: 0x018c1c1d, label: "T2-14283" },
  { start: 0x01d000d6, end: 0x01d0373b, label: "T3-13925" },
  { start: 0x01cf5669, end: 0x01cf8cbb, label: "T4-13906" },
  { start: 0x01a9372d, end: 0x01a96d0e, label: "T5-13793" },
];

function hexrow(p, n) {
  const slice = buf.slice(p, p + n);
  return Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
}
function ascrow(p, n) {
  const slice = buf.slice(p, p + n);
  return Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".").join("");
}
function dump(start, end, label) {
  console.log(`\n=== ${label}: 0x${start.toString(16)}..0x${end.toString(16)} (${end - start} B) ===`);
  console.log(`-- first 256 B --`);
  for (let p = start; p < start + 256; p += 32) {
    console.log(`0x${p.toString(16).padStart(8, "0")}  ${hexrow(p, 32)}  ${ascrow(p, 32)}`);
  }
  console.log(`-- last 256 B --`);
  for (let p = end - 256; p < end; p += 32) {
    console.log(`0x${p.toString(16).padStart(8, "0")}  ${hexrow(p, 32)}  ${ascrow(p, 32)}`);
  }
}

// 1) Dump head + tail of each target.
for (const t of TARGETS) dump(t.start, t.end, t.label);

// 2) Byte-histogram sanity check.
console.log(`\n=== byte histogram of each target (top 8 bytes) ===`);
for (const t of TARGETS) {
  const h = new Array(256).fill(0);
  for (let i = t.start; i < t.end; i++) h[buf[i]]++;
  const top = h.map((c, b) => [b, c]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = t.end - t.start;
  console.log(`${t.label}: ${top.map(([b, c]) => `0x${b.toString(16).padStart(2,"0")}×${c} (${(100*c/total).toFixed(1)}%)`).join(" ")}`);
}

// 3) Cross-compare first 16 bytes — do they look like random hashes?
console.log(`\n=== first 16 B of each target (the "hash header") ===`);
for (const t of TARGETS) {
  console.log(`${t.label}: ${hexrow(t.start, 16)}`);
}

// 4) First u32 at +0, +4, +8, +12 — look for any common values across targets.
console.log(`\n=== u32 at +0/+4/+8/+12/+16/+20/+24/+28 ===`);
for (const t of TARGETS) {
  const u = [];
  for (let o = 0; o <= 28; o += 4) u.push(buf.readUInt32LE(t.start + o).toString(16).padStart(8, "0"));
  console.log(`${t.label}: ${u.join("  ")}`);
}

// 5) Last 32 B u32 fields — terminator pattern?
console.log(`\n=== u32 at end-32..end-4 (last 8 u32 fields) ===`);
for (const t of TARGETS) {
  const u = [];
  for (let o = 32; o >= 4; o -= 4) u.push(buf.readUInt32LE(t.end - o).toString(16).padStart(8, "0"));
  console.log(`${t.label}: ${u.join("  ")}`);
}

// 6) Look for the 'ef' army-unit header BEFORE and AFTER each target — what
//    section bookends this family?
function scanAroundForUnit(start, end, label) {
  const PRE = 200, POST = 200;
  const pStart = Math.max(0, start - PRE);
  const pEnd = Math.min(buf.length, end + POST);
  // Hex+ascii dump the immediate context (40 B before, 40 B after).
  console.log(`\n-- ${label} context: 40 B before start, 40 B after end --`);
  console.log(`before: 0x${(start-40).toString(16)}  ${hexrow(start-40, 40)}  ${ascrow(start-40, 40)}`);
  console.log(`after:  0x${end.toString(16)}  ${hexrow(end, 40)}  ${ascrow(end, 40)}`);
}
for (const t of TARGETS) scanAroundForUnit(t.start, t.end, t.label);

// 7) Search each target for any ASCII run >= 4 chars — settlement names, tags.
console.log(`\n=== ASCII runs >=6 chars inside each target ===`);
for (const t of TARGETS) {
  const runs = [];
  let runStart = -1;
  for (let i = t.start; i <= t.end; i++) {
    const c = i < t.end ? buf[i] : 0;
    const printable = c >= 32 && c <= 126;
    if (printable && runStart < 0) runStart = i;
    else if (!printable && runStart >= 0) {
      const len = i - runStart;
      if (len >= 6) runs.push([runStart, len, buf.toString("ascii", runStart, i)]);
      runStart = -1;
    }
  }
  console.log(`${t.label}: ${runs.length} ascii runs`);
  for (const r of runs.slice(0, 12)) console.log(`  +0x${(r[0]-t.start).toString(16).padStart(5,"0")} len=${r[1]} "${r[2]}"`);
}

// 8) Look for the 16-byte hash header *signature* in the rest of the file —
//    if these blobs share a magic prefix, every occurrence should index here.
//    Use first 8 bytes of T1 as a probe (rare-byte fingerprint).
console.log(`\n=== probe: T1's first 8 B as fingerprint ===`);
const probe = buf.slice(TARGETS[0].start, TARGETS[0].start + 8);
console.log(`probe = ${Array.from(probe).map(b=>b.toString(16).padStart(2,"0")).join(" ")}`);
let hits = [], q = 0;
while (q < buf.length) {
  const i = buf.indexOf(probe, q);
  if (i < 0) break;
  hits.push(i);
  q = i + 1;
}
console.log(`probe hits across whole file: ${hits.length}`);
for (const h of hits.slice(0, 20)) console.log(`  0x${h.toString(16)}`);
