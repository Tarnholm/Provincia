// dig-record-pointer-table.js — hunt for a table of u32 pointers to dead
// record positions. If splicing invalidates a pointer list, that explains
// the infinite "next < buffer_end" loop: the engine dereferences each
// stale pointer, fails, and retries.
//
// Strategy:
//   1. For each dead record, record its lenPrefixOff (= candidate pointer
//      target).
//   2. Scan the entire file for u32 LE matches to those positions.
//   3. Find regions where MANY positions hit — those are pointer tables.
//   4. Report the densest pointer-table region.

"use strict";
const fs = require("fs");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const DEAD = Buffer.from("/portraits/dead/", "ascii");
const buf = fs.readFileSync(SRC);

function locateRecords() {
  const records = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(DEAD, from);
    if (i < 0) break;
    let dataOff = -1;
    for (let p = i - 1; p >= i - 64; p--) {
      if (buf[p] === 0x64 && buf[p+1] === 0x61 && buf[p+2] === 0x74 && buf[p+3] === 0x61 && buf[p+4] === 0x2f) {
        dataOff = p; break;
      }
    }
    if (dataOff < 0) { from = i + DEAD.length; continue; }
    const lenPrefixOff = dataOff - 2;
    const pathLen = buf.readUInt16LE(lenPrefixOff);
    if (pathLen < 16 || pathLen > 200) { from = i + DEAD.length; continue; }
    records.push({ lenPrefixOff, dataOff });
    from = dataOff + pathLen;
  }
  return records;
}

const recs = locateRecords();
console.log(`records: ${recs.length}`);

// Build a set of candidate-pointer values: every record's lenPrefixOff
// AND its dataOff (in case the pointer points to 'data/' not the length).
const targetSet = new Set();
for (const r of recs) {
  targetSet.add(r.lenPrefixOff);
  targetSet.add(r.dataOff);
}
console.log(`pointer-target set size: ${targetSet.size}`);

// Scan the whole file for u32 LE matches to any target. Record the position
// and which record-index it points to.
console.log("\nscanning for u32 matches (this takes ~10s)...");
const hits = []; // [{ pos, target }]
for (let p = 0; p + 3 < buf.length; p++) {
  const v = buf.readUInt32LE(p);
  if (targetSet.has(v)) hits.push({ pos: p, target: v });
}
console.log(`u32 matches to any record pointer: ${hits.length}`);

if (hits.length === 0) {
  console.log("NO pointer-table hits. If pointer-list existed, it would surface here.");
  console.log("Pointer-list hypothesis may be wrong — try next: per-record next-offsets at record end.");
  process.exit(0);
}

// Find clusters of hits — runs where consecutive hits are <= 16 bytes apart.
// A real pointer table would be u32 spacing (= 4 bytes) or u32+somevalue spacing.
hits.sort((a, b) => a.pos - b.pos);
const clusters = [];
let cur = { start: hits[0].pos, end: hits[0].pos + 4, count: 1, items: [hits[0]] };
for (let i = 1; i < hits.length; i++) {
  const gap = hits[i].pos - hits[i - 1].pos;
  if (gap <= 16) {
    cur.end = hits[i].pos + 4;
    cur.count++;
    cur.items.push(hits[i]);
  } else {
    if (cur.count >= 5) clusters.push(cur);
    cur = { start: hits[i].pos, end: hits[i].pos + 4, count: 1, items: [hits[i]] };
  }
}
if (cur.count >= 5) clusters.push(cur);

console.log(`\npointer-dense clusters (>=5 hits within 16B stride): ${clusters.length}`);
clusters.sort((a, b) => b.count - a.count);
for (const c of clusters.slice(0, 12)) {
  const stride = c.count > 1 ? Math.round((c.end - c.start) / c.count) : "-";
  console.log(`  0x${c.start.toString(16)} .. 0x${c.end.toString(16)}  hits=${c.count}  stride=${stride}`);
  // Show first few item targets
  const sample = c.items.slice(0, 4).map(it => `@0x${it.pos.toString(16)}->0x${it.target.toString(16)}`);
  console.log(`    sample: ${sample.join(", ")}`);
}
