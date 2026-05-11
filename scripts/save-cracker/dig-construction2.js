#!/usr/bin/env node
// Shift-aware construction diff — find offset where A and B realign after the +900 size diff.
// Method: for each candidate "anchor" region, find longest common substring after shift.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const a = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const b = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

// Strategy: find first position where A and B diverge, then look for resync
// where they re-align at A[x] === B[x+delta] for various deltas.
function findFirstDiff(off) {
  for (let i = off; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

function findResync(aStart, bStart, runLen=64) {
  // Find next position after aStart where the next runLen bytes of a match b at some position
  for (let i = aStart; i < a.length - runLen; i++) {
    const target = a.slice(i, i + runLen);
    // Search b within +/- 4096 bytes of bStart for this run
    for (let j = Math.max(0, bStart - 64); j < Math.min(b.length - runLen, bStart + 4096); j++) {
      let ok = true;
      for (let k = 0; k < runLen; k++) {
        if (a[i+k] !== b[j+k]) { ok = false; break; }
      }
      if (ok) return [i, j];
    }
    if (i > aStart + 8192) break; // give up after 8KB
  }
  return null;
}

let aPtr = 0, bPtr = 0;
const segments = [];
let iter = 0;
while (aPtr < a.length && bPtr < b.length && iter < 200) {
  iter++;
  const aDiff = findFirstDiff(aPtr);
  if (aDiff < 0 || aDiff >= a.length - 64) break;
  // Now find re-sync
  // First skip the bytes that differ
  // We assume the local difference is small or large (insertion).
  // Try direct resync: look for a 64-byte run of a starting at aDiff+N that matches b somewhere starting at >=bDiff
  const bDiff = aDiff; // assumes same alignment up to here
  // Find a 64-byte stable point starting from aDiff+1
  let resyncFound = false;
  for (let stride = 1; stride < 4096; stride++) {
    if (aDiff + stride + 64 >= a.length) break;
    // try shifted match in b
    for (let shift = -8; shift <= 4096; shift++) {
      const bPos = bDiff + stride + shift;
      if (bPos < 0 || bPos + 64 >= b.length) continue;
      let ok = true;
      for (let k = 0; k < 64; k++) {
        if (a[aDiff + stride + k] !== b[bPos + k]) { ok = false; break; }
      }
      if (ok) {
        segments.push({ aStart: aDiff, aEnd: aDiff + stride, bStart: bDiff, bEnd: bPos, shift: bPos - (aDiff + stride) });
        aPtr = aDiff + stride;
        bPtr = bPos;
        resyncFound = true;
        break;
      }
    }
    if (resyncFound) break;
  }
  if (!resyncFound) {
    // Skip ahead and try again
    aPtr = aDiff + 1;
    bPtr = aDiff + 1;
  }
}

console.log(`Diff segments found: ${segments.length}`);
for (const s of segments.slice(0, 50)) {
  console.log(`  A[0x${s.aStart.toString(16)}..0x${s.aEnd.toString(16)}] len=${s.aEnd - s.aStart} -> B[0x${s.bStart.toString(16)}..0x${s.bEnd.toString(16)}] len=${s.bEnd - s.bStart} shift=${s.shift}`);
  // Dump short hex of diff region
  const aSlice = a.slice(s.aStart, Math.min(s.aEnd, s.aStart + 48));
  const bSlice = b.slice(s.bStart, Math.min(s.bEnd, s.bStart + 48));
  console.log(`    A: ${aSlice.toString('hex')}`);
  console.log(`    B: ${bSlice.toString('hex')}`);
}
