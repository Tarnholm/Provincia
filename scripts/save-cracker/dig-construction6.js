#!/usr/bin/env node
// Better resync algorithm — use moving 16-byte block matching to align A and B.
// Then catalog all diffs by region.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

console.log(`A=${A.length}, B=${B.length}, ΔB=${B.length-A.length}`);

// Build an index of 16-byte rolling hashes in B for fast lookup
const BLOCK = 16;
const STEP = 4;
const bIndex = new Map(); // hash -> [positions]
for (let i = 0; i + BLOCK <= B.length; i += STEP) {
  const h = B.readUInt32LE(i) ^ (B.readUInt32LE(i+4) * 17) ^ (B.readUInt32LE(i+8) * 257) ^ (B.readUInt32LE(i+12) * 1031);
  if (!bIndex.has(h)) bIndex.set(h, []);
  bIndex.get(h).push(i);
}

// Walk A and find best matches in B (preserving ordering)
let aPtr = 0;
let bPtr = 0;
const segments = []; // {aStart, aLen, bStart, bLen}
let segMatch = []; // streak of matching positions
let lastAEqualPos = 0;

// Simple greedy: walk forward in A, at each non-matching position, find next matching block.
function blockEquals(aPos, bPos) {
  for (let k = 0; k < BLOCK; k++) {
    if (A[aPos+k] !== B[bPos+k]) return false;
  }
  return true;
}

let segStart = 0; // start of current diff region in A
let segBStart = 0; // start of current diff region in B
let diffs = [];

while (aPtr < A.length - BLOCK && bPtr < B.length - BLOCK) {
  if (blockEquals(aPtr, bPtr)) {
    // matching - if we were in a diff region, close it
    if (aPtr > segStart || bPtr > segBStart) {
      diffs.push({ aStart: segStart, aEnd: aPtr, bStart: segBStart, bEnd: bPtr });
    }
    // Skip past the matching block
    aPtr += STEP;
    bPtr += STEP;
    segStart = aPtr;
    segBStart = bPtr;
  } else {
    // Find next matching position by hash lookup
    const h = A.readUInt32LE(aPtr) ^ (A.readUInt32LE(aPtr+4) * 17) ^ (A.readUInt32LE(aPtr+8) * 257) ^ (A.readUInt32LE(aPtr+12) * 1031);
    const candidates = bIndex.get(h);
    let found = false;
    if (candidates) {
      for (const bPos of candidates) {
        if (bPos < bPtr) continue;
        if (bPos > bPtr + 100000) break;
        if (blockEquals(aPtr, bPos)) {
          // We've skipped from (segStart..aPtr) in A and (segBStart..bPos) in B
          diffs.push({ aStart: segStart, aEnd: aPtr, bStart: segBStart, bEnd: bPos });
          aPtr += STEP;
          bPtr = bPos + STEP;
          segStart = aPtr;
          segBStart = bPtr;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      aPtr += 1; // skip one byte at a time when no match
    }
  }
}

// Add final segment
diffs.push({ aStart: segStart, aEnd: A.length, bStart: segBStart, bEnd: B.length });

// Filter out empty diffs and small ones
const realDiffs = diffs.filter(d => (d.aEnd - d.aStart) > 0 || (d.bEnd - d.bStart) > 0);
console.log(`\nTotal diff regions: ${realDiffs.length}`);

// Compute size deltas
let totalAdelta = 0, totalBdelta = 0;
for (const d of realDiffs) {
  totalAdelta += d.aEnd - d.aStart;
  totalBdelta += d.bEnd - d.bStart;
}
console.log(`Total A bytes changed: ${totalAdelta}`);
console.log(`Total B bytes changed: ${totalBdelta}`);
console.log(`Net size delta: ${totalBdelta - totalAdelta} (file diff: ${B.length - A.length})`);

// Show top diffs
realDiffs.sort((x, y) => (y.aEnd - y.aStart + y.bEnd - y.bStart) - (x.aEnd - x.aStart + x.bEnd - x.bStart));
console.log(`\nTop 50 diff regions by total bytes changed:`);
for (const d of realDiffs.slice(0, 50)) {
  const aLen = d.aEnd - d.aStart;
  const bLen = d.bEnd - d.bStart;
  console.log(`  A[0x${d.aStart.toString(16)}..0x${d.aEnd.toString(16)}] aLen=${aLen} | B[0x${d.bStart.toString(16)}..0x${d.bEnd.toString(16)}] bLen=${bLen} | sizeΔ=${bLen-aLen}`);
}

// Now filter: ones where aLen == bLen (in-place edits, no insertion)
const inPlaceDiffs = realDiffs.filter(d => (d.aEnd - d.aStart) === (d.bEnd - d.bStart) && (d.aEnd - d.aStart) > 0);
inPlaceDiffs.sort((x, y) => (x.aEnd - x.aStart) - (y.aEnd - y.aStart));
console.log(`\nIn-place diff regions (same length on both sides): ${inPlaceDiffs.length}`);
console.log(`(Sorted by size, showing smallest 50 — these are likely state-bit/counter changes):`);
for (const d of inPlaceDiffs.slice(0, 50)) {
  const len = d.aEnd - d.aStart;
  const aHex = A.slice(d.aStart, d.aEnd).toString('hex');
  const bHex = B.slice(d.bStart, d.bEnd).toString('hex');
  console.log(`  A@0x${d.aStart.toString(16)}..+${len} | B@0x${d.bStart.toString(16)} | A: ${aHex} | B: ${bHex}`);
}

// Diffs that ADD bytes (b > a) — these are construction-related insertions
const insertDiffs = realDiffs.filter(d => (d.bEnd - d.bStart) > (d.aEnd - d.aStart));
console.log(`\nInsert diff regions (B grew): ${insertDiffs.length}`);
for (const d of insertDiffs.slice(0, 30)) {
  const aLen = d.aEnd - d.aStart;
  const bLen = d.bEnd - d.bStart;
  console.log(`  A[0x${d.aStart.toString(16)}..+${aLen}] | B[0x${d.bStart.toString(16)}..+${bLen}] | +${bLen-aLen} bytes`);
  if (bLen <= 200) {
    const bSlice = B.slice(d.bStart, d.bEnd);
    console.log(`    B: ${bSlice.toString('hex')}`);
    // Look for ASCII strings
    const ascii = bSlice.toString('binary').replace(/[^\x20-\x7e]/g, '.');
    console.log(`    B ascii: ${ascii}`);
  }
}
