// dig-diplo-5.js — session 108 step 5
//
// New approach: search the ENTIRE save_1.2.sav for a repeating stride-K table
// of length 23 (or 22, 21, 20) that could be a global N×N diplomatic relations
// matrix.
//
// For RIS imperial (23 majors), the matrix could be:
//   * 23 × 23 cells = 529 cells. Each cell N bytes.
//   * 23 rows × 22 entries per row (upper-triangle of factions) = 506 cells.
// Most likely: stride-4 per cell (war/peace flag) → 23*23*4 = 2116 bytes block.
//
// Alternatively: a per-pair 16-byte struct → 506 * 16 = 8096 bytes block.
//
// Strategy:
//   1. Compute autocorrelation by stride S=4,8,16,32 over save_1.2 and look
//      for windows where every 23rd element (or every 22nd) shares the same
//      value pattern.
//   2. Look for "matrix-like" zones via byte-frequency narrowness (a
//      diplo-flag table has only a few discrete byte values).
//
// Simpler: ALSO try the symmetric-pair check. If a region is 23×23 = 529
// u32, then byte (i,j) == byte (j,i) means symmetric. Many diplomatic states
// (war / peace / alliance) are symmetric.
//
// Usage: node dig-diplo-5.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_1.2.sav");
const buf = fs.readFileSync(SAVE);
console.log(`save_1.2.sav: ${buf.length} B`);

// Step 1: find candidate "N×N matrix" zones — windows of size N*N*cellSize
// where the values are bounded to a small set.
// N=23 (majors). cellSize candidates: 1, 2, 4, 8, 16.
// Search the whole file with a sliding window.

function entropyByteSet(b, start, len) {
  const seen = new Set();
  for (let i = 0; i < len; i++) seen.add(b[start + i]);
  return seen.size;
}

// Check if a window is "symmetric N×N of stride cellSize" — bytes at (i,j) match (j,i).
function symmetryScore(b, start, N, cellSize) {
  let matches = 0;
  let total = 0;
  const rowSize = N * cellSize;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const aOff = start + i * rowSize + j * cellSize;
      const bOff = start + j * rowSize + i * cellSize;
      let allMatch = true;
      for (let k = 0; k < cellSize; k++) {
        if (b[aOff + k] !== b[bOff + k]) { allMatch = false; break; }
      }
      if (allMatch) matches += 1;
      total += 1;
    }
  }
  return { matches, total, ratio: matches / total };
}

const N = 23;

// Try several cell sizes
const cells = [1, 2, 4, 8, 16];
for (const c of cells) {
  const windowSize = N * N * c;
  // Slide through the file every 4 bytes
  let bestScore = 0;
  let bestOff = -1;
  const step = 16; // coarse pass
  console.log(`\n=== N=${N} cellSize=${c} window=${windowSize} ===`);
  for (let off = 0; off + windowSize < buf.length; off += step) {
    // Quick filter: byte entropy must be low (matrix of mostly 0/1/2/3 enums)
    const uniq = entropyByteSet(buf, off, Math.min(windowSize, 256));
    if (uniq > 20) continue; // skip noisy
    const sc = symmetryScore(buf, off, N, c);
    if (sc.ratio > bestScore && sc.matches > 100) {
      bestScore = sc.ratio;
      bestOff = off;
    }
  }
  if (bestOff >= 0) {
    console.log(`  best symmetric window: pos=0x${bestOff.toString(16)} ratio=${(bestScore * 100).toFixed(1)}%`);
    // Refine: scan within 16 bytes for the exact best
    let refOff = bestOff;
    let refScore = bestScore;
    for (let d = -32; d <= 32; d++) {
      const o = bestOff + d;
      if (o < 0 || o + windowSize > buf.length) continue;
      const sc = symmetryScore(buf, o, N, c);
      if (sc.ratio > refScore) { refScore = sc.ratio; refOff = o; }
    }
    console.log(`  refined: pos=0x${refOff.toString(16)} ratio=${(refScore * 100).toFixed(1)}%`);
  } else {
    console.log(`  no candidate found`);
  }
}

// Also try N=22 (other factions per row, with self excluded)
console.log("\n\n=========== Trying N=22 (others-per-row) ===========");
for (const c of [1, 2, 4]) {
  const windowSize = 22 * 22 * c;
  let bestScore = 0;
  let bestOff = -1;
  const step = 16;
  console.log(`\n=== N=22 cellSize=${c} window=${windowSize} ===`);
  for (let off = 0; off + windowSize < buf.length; off += step) {
    const uniq = entropyByteSet(buf, off, Math.min(windowSize, 256));
    if (uniq > 20) continue;
    const sc = symmetryScore(buf, off, 22, c);
    if (sc.ratio > bestScore && sc.matches > 80) {
      bestScore = sc.ratio;
      bestOff = off;
    }
  }
  if (bestOff >= 0) {
    console.log(`  best symmetric window: pos=0x${bestOff.toString(16)} ratio=${(bestScore * 100).toFixed(1)}%`);
  } else {
    console.log(`  no candidate found`);
  }
}
