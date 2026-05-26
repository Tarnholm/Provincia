// dig-deadpool-count-v3.js — inspect the GAP between consecutive per-faction
// pools. The count header for pool N+1 likely lives in the gap after pool N.
//
// Key observation from v2: preludes contain the END of the previous record,
// not a header. Inter-record bytes are packed tight. So the count header must
// sit in the inter-POOL gap, not in the immediate prelude.
//
// Plan: for each cluster boundary, dump bytes [prevCluster.lastOff + 64 ..
// nextCluster.firstOff]. Within that range, search for a u32 that equals
// EITHER cluster's record count. Report consistent positional patterns.

"use strict";
const fs = require("fs");
const path = require("path");

const SRC = "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav";
const NEEDLE = Buffer.from("/portraits/dead/", "ascii");
const TARGET_CLUSTERS = 238;
const MIN_CLUSTER = 20; // skip tiny ones

const buf = fs.readFileSync(SRC);

const hits = [];
{ let from = 0; while (true) { const i = buf.indexOf(NEEDLE, from); if (i < 0) break; hits.push(i); from = i + NEEDLE.length; } }

const gapsIdx = [];
for (let i = 1; i < hits.length; i++) gapsIdx.push({ gap: hits[i] - hits[i - 1], idx: i });
gapsIdx.sort((a, b) => b.gap - a.gap);
const boundarySet = new Set(gapsIdx.slice(0, TARGET_CLUSTERS - 1).map(g => g.idx));

const clusters = [];
{
  let start = 0;
  for (let i = 1; i < hits.length; i++) {
    if (boundarySet.has(i)) { clusters.push({ recordCount: i - start, firstOff: hits[start], lastOff: hits[i - 1] }); start = i; }
  }
  clusters.push({ recordCount: hits.length - start, firstOff: hits[start], lastOff: hits[hits.length - 1] });
}

function dumpHex(off, len) {
  return buf.slice(Math.max(0, off), Math.min(off + len, buf.length))
    .toString("hex").match(/.{2}/g).join(" ");
}
function dumpAscii(off, len) {
  const s = buf.slice(Math.max(0, off), Math.min(off + len, buf.length));
  return Array.from(s).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
}

// Try to find the END of each cluster's LAST record. The last record's
// portrait path is at `cluster.lastOff`. The record body extends some
// bytes past lastOff. Without a closing marker we just take a fixed
// estimate (median record size = ~470 from v2).
const RECORD_TAIL_ESTIMATE = 470;

console.log("inter-cluster gap content (first 8 transitions):");
console.log();
for (let i = 0; i < Math.min(clusters.length - 1, 12); i++) {
  const A = clusters[i];
  const B = clusters[i + 1];
  if (A.recordCount < MIN_CLUSTER || B.recordCount < MIN_CLUSTER) continue;
  const gapStart = A.lastOff + RECORD_TAIL_ESTIMATE;
  const gapEnd   = B.firstOff;
  const gapLen   = gapEnd - gapStart;
  console.log(`=== gap between cluster ${i} (recs=${A.recordCount}, lastOff=0x${A.lastOff.toString(16)}) and cluster ${i+1} (recs=${B.recordCount}, firstOff=0x${B.firstOff.toString(16)}) ===`);
  console.log(`gap range: 0x${gapStart.toString(16)} .. 0x${gapEnd.toString(16)}  (${gapLen} bytes)`);

  // Hunt for u32 == A.recordCount or B.recordCount anywhere in the gap.
  const hitsA = [], hitsB = [];
  if (gapLen > 4) {
    for (let p = gapStart; p < gapEnd - 3; p++) {
      const v = buf.readUInt32LE(p);
      if (v === A.recordCount) hitsA.push(p);
      if (v === B.recordCount) hitsB.push(p);
    }
  }
  console.log(`u32 == A.count (${A.recordCount}): ${hitsA.length} hits${hitsA.length ? "  @ " + hitsA.slice(0,4).map(h => "0x"+h.toString(16)+" (rel-to-B "+(h-B.firstOff)+")").join(", ") : ""}`);
  console.log(`u32 == B.count (${B.recordCount}): ${hitsB.length} hits${hitsB.length ? "  @ " + hitsB.slice(0,4).map(h => "0x"+h.toString(16)+" (rel-to-B "+(h-B.firstOff)+")").join(", ") : ""}`);

  // Dump first 96 bytes of the gap and last 96 before B.firstOff (with ascii).
  const head = Math.min(96, gapLen);
  console.log(`head[0x${gapStart.toString(16)}..]: ${dumpHex(gapStart, head)}`);
  console.log(`            ascii: ${dumpAscii(gapStart, head)}`);
  if (gapLen > 192) {
    const tailOff = gapEnd - 96;
    console.log(`tail[0x${tailOff.toString(16)}..0x${gapEnd.toString(16)}]: ${dumpHex(tailOff, 96)}`);
    console.log(`            ascii: ${dumpAscii(tailOff, 96)}`);
  }
  console.log();
}

// Aggregate hunt: for ALL big clusters, find the position relative to
// B.firstOff where u32 == B.recordCount in the gap.
console.log("--- aggregate hunt: rel-to-firstOff of u32==count, ALL big clusters ---");
const relHisto = new Map();
let withHit = 0;
for (let i = 0; i < clusters.length - 1; i++) {
  const A = clusters[i];
  const B = clusters[i + 1];
  if (B.recordCount < MIN_CLUSTER) continue;
  const gapStart = A.lastOff + RECORD_TAIL_ESTIMATE;
  const gapEnd   = B.firstOff;
  if (gapStart >= gapEnd) continue;
  let hit = null;
  for (let p = gapStart; p < gapEnd - 3; p++) {
    if (buf.readUInt32LE(p) === B.recordCount) {
      hit = p;
      break;
    }
  }
  if (hit !== null) {
    withHit++;
    const rel = hit - B.firstOff;
    relHisto.set(rel, (relHisto.get(rel) || 0) + 1);
  }
}
const rankedRel = [...relHisto.entries()].sort((a, b) => b[1] - a[1]);
console.log(`big-cluster transitions with B-count hit somewhere in gap: ${withHit}`);
console.log("top relative offsets (negative = before B.firstOff):");
for (const [rel, c] of rankedRel.slice(0, 12)) {
  console.log(`  rel ${String(rel).padStart(6)}  ${String(c).padStart(3)} clusters`);
}
