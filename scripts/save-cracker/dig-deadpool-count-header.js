// dig-deadpool-count-header.js — hunt for the per-faction dead-pool COUNT
// header that gates "decrement-and-truncate" pruning.
//
// Premise (from RESUME notes): /portraits/dead/ records cluster by faction.
// Each cluster (= one faction's dead pool) should be preceded by a small
// header. If a u32 just before a cluster equals the cluster's record count,
// that's the count we can decrement. Decrement-and-truncate then frees real
// registry slots.
//
// Strategy:
//   1. Index every "/portraits/dead/" hit.
//   2. Cluster: consecutive hits whose record bodies abut are one faction's
//      pool. A "gap" between clusters = the boundary between factions.
//   3. For each cluster, dump 64 B BEFORE the first record. Search those
//      bytes for any u32 equal to the cluster size.
//   4. Report: which factions have an obvious count-header, and at what
//      relative offset from the first record.
//
// Run:  node scripts/save-cracker/dig-deadpool-count-header.js

"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const NEEDLE = Buffer.from("/portraits/dead/", "ascii");

const buf = fs.readFileSync(SRC);
console.log(`source: ${path.basename(SRC)}  (${buf.length.toLocaleString()} bytes)`);

// --- 1. Index every dead-record hit ---------------------------------------
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

// --- 2. Cluster by gap ----------------------------------------------------
// A record's "size" is roughly hits[i+1] - hits[i]. Median is the typical
// per-record stride. A cluster boundary appears when the gap is much larger
// than the median (e.g. > 4x).
const gaps = [];
for (let i = 1; i < hits.length; i++) gaps.push(hits[i] - hits[i - 1]);
gaps.sort((a, b) => a - b);
const median = gaps[Math.floor(gaps.length / 2)];
const p90    = gaps[Math.floor(gaps.length * 0.90)];
const p99    = gaps[Math.floor(gaps.length * 0.99)];
console.log(`record-stride distribution: median=${median}  p90=${p90}  p99=${p99}  max=${gaps[gaps.length-1]}`);

// Cluster boundary = any gap >= 4x median. Tunable.
const BOUNDARY = Math.max(4 * median, 1024);
console.log(`cluster boundary threshold: gap >= ${BOUNDARY} bytes`);
console.log();

const clusters = [];
{
  let start = 0;
  for (let i = 1; i < hits.length; i++) {
    if (hits[i] - hits[i - 1] >= BOUNDARY) {
      clusters.push({
        startHit: start, endHit: i - 1,
        recordCount: i - start,
        firstOff: hits[start], lastOff: hits[i - 1],
      });
      start = i;
    }
  }
  clusters.push({
    startHit: start, endHit: hits.length - 1,
    recordCount: hits.length - start,
    firstOff: hits[start], lastOff: hits[hits.length - 1],
  });
}
console.log(`clusters (= candidate per-faction dead pools): ${clusters.length}`);
console.log();

// --- 3. For each cluster, inspect the 64 B before the first record --------
// Each /portraits/dead/ string is the PORTRAIT-PATH field of a dead record.
// The record's actual START is some bytes earlier. From test-dead-pool we
// know the path appears early in the record but isn't at +0. Walk backwards
// from each first hit to find: (a) the record start, then (b) the header.
//
// We don't yet know the record start offset; let's just dump bytes from
// [first_hit - 256 .. first_hit + 16] and search for u32 == recordCount.

function dumpHex(off, len) {
  const end = Math.min(off + len, buf.length);
  const start = Math.max(0, off);
  const hex = buf.slice(start, end).toString("hex");
  return hex.match(/.{2}/g).join(" ");
}

let foundCount = 0;
let plausibleCountOffsets = []; // record relative offsets where count appeared

for (let ci = 0; ci < clusters.length; ci++) {
  const c = clusters[ci];

  // Hunt: in the 256 bytes BEFORE c.firstOff, is there a u32 == c.recordCount?
  const huntStart = Math.max(0, c.firstOff - 256);
  const huntEnd   = c.firstOff;
  const found = [];
  for (let p = huntStart; p < huntEnd - 3; p++) {
    const v = buf.readUInt32LE(p);
    if (v === c.recordCount) {
      found.push({ off: p, rel: p - c.firstOff });
    }
    // Also try: count + 1, count - 1 (off-by-one possibilities).
    if (v === c.recordCount + 1 || v === c.recordCount - 1) {
      found.push({ off: p, rel: p - c.firstOff, note: `±1 (=${v})` });
    }
  }

  if (ci < 12 || found.length > 0) {
    const label = `cluster ${ci}`.padEnd(11);
    console.log(`${label}  records=${String(c.recordCount).padStart(5)}  firstOff=0x${c.firstOff.toString(16)}  lastOff=0x${c.lastOff.toString(16)}`);
    if (found.length) {
      foundCount++;
      for (const f of found) {
        console.log(`    HIT u32@0x${f.off.toString(16)} (rel ${f.rel})  ${f.note || ""}`);
        plausibleCountOffsets.push(f.rel);
      }
    }
  }
}

console.log();
console.log(`clusters with a plausible count-header hit: ${foundCount} / ${clusters.length}`);

// If a particular relative offset shows up consistently across clusters,
// that's our header field.
if (plausibleCountOffsets.length > 0) {
  const histo = new Map();
  for (const r of plausibleCountOffsets) histo.set(r, (histo.get(r) || 0) + 1);
  const sorted = [...histo.entries()].sort((a, b) => b[1] - a[1]);
  console.log();
  console.log("Most common relative offsets (rel to firstOff of cluster):");
  for (const [rel, count] of sorted.slice(0, 8)) {
    console.log(`  rel ${String(rel).padStart(5)}  appears in ${count} clusters`);
  }
}

// --- 4. Bonus: show the bytes immediately before the FIRST cluster --------
// Likely contains the cluster's structural header.
const first = clusters[0];
console.log();
console.log(`--- bytes 0x${(first.firstOff - 64).toString(16)} .. 0x${(first.firstOff + 16).toString(16)} (cluster 0 prelude) ---`);
console.log(dumpHex(first.firstOff - 64, 80));
