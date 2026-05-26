// dig-deadpool-count-v2.js — refined cluster hunt for dead-pool count header.
//
// v1 over-clustered (493 vs ~238 expected) and matched too many small u32s.
// v2 fixes:
//   1. Cluster boundary = top-N largest gaps, where N is selectable.
//      (avoids the "is 4x median the right threshold" guess.)
//   2. Hunt is EXACT-match only (no ±1), so signal is real signal.
//   3. Only inspect clusters with ≥ 30 records — too-small clusters have
//      too many coincidental small u32 matches.
//   4. Dumps 32-byte preludes side-by-side so structural similarities are
//      visible at a glance, even when the COUNT isn't a clean u32 LE.

"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const NEEDLE = Buffer.from("/portraits/dead/", "ascii");
const TARGET_CLUSTERS = 238; // faction count
const MIN_INSPECT_RECS = 30;

const buf = fs.readFileSync(SRC);
console.log(`source: ${path.basename(SRC)}  (${buf.length.toLocaleString()} bytes)`);

const hits = [];
{
  let from = 0;
  while (true) {
    const i = buf.indexOf(NEEDLE, from);
    if (i < 0) break;
    hits.push(i);
    from = i + NEEDLE.length;
  }
}
console.log(`/portraits/dead/ occurrences: ${hits.length}`);

// Find the (TARGET_CLUSTERS - 1) largest gaps. Boundary = the smallest of
// those = the threshold that gives exactly TARGET_CLUSTERS clusters.
const gapsIdx = []; // [{gap, between i-1 and i}]
for (let i = 1; i < hits.length; i++) {
  gapsIdx.push({ gap: hits[i] - hits[i - 1], idx: i });
}
gapsIdx.sort((a, b) => b.gap - a.gap);
const boundarySet = new Set(gapsIdx.slice(0, TARGET_CLUSTERS - 1).map(g => g.idx));
const threshold = gapsIdx[TARGET_CLUSTERS - 2].gap;
console.log(`boundary threshold for ${TARGET_CLUSTERS} clusters: gap >= ${threshold} bytes`);
console.log();

const clusters = [];
{
  let start = 0;
  for (let i = 1; i < hits.length; i++) {
    if (boundarySet.has(i)) {
      clusters.push({ startHit: start, endHit: i - 1, recordCount: i - start, firstOff: hits[start], lastOff: hits[i - 1] });
      start = i;
    }
  }
  clusters.push({ startHit: start, endHit: hits.length - 1, recordCount: hits.length - start, firstOff: hits[start], lastOff: hits[hits.length - 1] });
}
console.log(`clusters: ${clusters.length}`);

// Distribution
const sizes = clusters.map(c => c.recordCount).sort((a, b) => a - b);
console.log(`cluster sizes: min=${sizes[0]}  p25=${sizes[Math.floor(sizes.length*0.25)]}  median=${sizes[Math.floor(sizes.length/2)]}  p75=${sizes[Math.floor(sizes.length*0.75)]}  max=${sizes[sizes.length-1]}`);
console.log();

function dumpHex(off, len) {
  const end = Math.min(off + len, buf.length);
  const start = Math.max(0, off);
  return buf.slice(start, end).toString("hex").match(/.{2}/g).join(" ");
}

// For each big-enough cluster, scan the 256 B prelude for EXACT count.
// Also dump the 32 B immediately preceding firstOff for visual scan.
const bigClusters = clusters.filter(c => c.recordCount >= MIN_INSPECT_RECS);
console.log(`inspecting ${bigClusters.length} clusters with >= ${MIN_INSPECT_RECS} records:`);
console.log();

const allRelHits = []; // rel offset where count was found, per cluster
for (let i = 0; i < bigClusters.length; i++) {
  const c = bigClusters[i];
  const hunt = [];
  const huntStart = Math.max(0, c.firstOff - 256);
  for (let p = huntStart; p < c.firstOff - 3; p++) {
    if (buf.readUInt32LE(p) === c.recordCount) {
      hunt.push(p - c.firstOff);
    }
  }
  allRelHits.push({ count: c.recordCount, rels: hunt });
  if (i < 16) {
    const preludeHex = dumpHex(c.firstOff - 32, 32);
    console.log(`cluster${String(i).padStart(3)}  recs=${String(c.recordCount).padStart(4)}  firstOff=0x${c.firstOff.toString(16)}  exact-rel-hits=${hunt.length ? hunt.join(",") : "(none)"}`);
    console.log(`         prelude[-32]: ${preludeHex}`);
  }
}

// Histogram: which relative offsets are consistently the count?
const relHisto = new Map();
for (const ah of allRelHits) {
  for (const r of ah.rels) relHisto.set(r, (relHisto.get(r) || 0) + 1);
}
const ranked = [...relHisto.entries()].sort((a, b) => b[1] - a[1]);
console.log();
console.log(`relative-offset frequency across ${bigClusters.length} big clusters (where u32 == cluster.recordCount):`);
for (const [rel, cnt] of ranked.slice(0, 16)) {
  const pct = (100 * cnt / bigClusters.length).toFixed(1);
  console.log(`  rel ${String(rel).padStart(5)}  hits in ${String(cnt).padStart(3)} clusters  (${pct}%)`);
}
console.log();
console.log(`clusters with NO exact count hit in 256B prelude: ${allRelHits.filter(x => x.rels.length === 0).length} / ${bigClusters.length}`);

// Also try: count-as-u16, count-as-u8.
console.log();
console.log("--- secondary: u16/u8 match attempts ---");
let u16Found = 0, u8Found = 0;
for (const c of bigClusters) {
  const huntStart = Math.max(0, c.firstOff - 256);
  let foundU16 = false, foundU8 = false;
  for (let p = huntStart; p < c.firstOff - 1; p++) {
    if (c.recordCount <= 0xffff && buf.readUInt16LE(p) === c.recordCount) { foundU16 = true; break; }
  }
  for (let p = huntStart; p < c.firstOff; p++) {
    if (c.recordCount <= 0xff && buf[p] === c.recordCount) { foundU8 = true; break; }
  }
  if (foundU16) u16Found++;
  if (foundU8) u8Found++;
}
console.log(`big clusters with u16 == count in 256B prelude: ${u16Found} / ${bigClusters.length}`);
console.log(`big clusters with u8  == count in 256B prelude: ${u8Found} / ${bigClusters.length}`);
