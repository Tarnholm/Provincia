// Session 32 step F: characterize the enum values used in the matrix.
// Each record is 267 bytes, matrix is 239x239, starting at enum offset 0xf8fd2.
// Index 0 = romans_julii, index 156 = messapians.
// Print: enum value distribution, which (row,col) pairs have non-default values.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

const stride = 267;
const matStart = 0xf8fd2;
const N = 239;

function getEnum(buf, r, c) {
  const idx = r * N + c;
  const off = matStart + idx * stride;
  return buf.readUInt32LE(off);
}

// 1. Histogram of enums in A (the BEFORE save).
const hist = {};
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const v = getEnum(a, r, c);
    hist[v] = (hist[v] || 0) + 1;
  }
}
console.log(`Enum histogram (A, all 57121 cells):`);
const top = Object.entries(hist).sort((x, y) => y[1] - x[1]).slice(0, 20);
for (const [v, c] of top) console.log(`  enum=${v}: ${c}`);

// 2. List all non-default (enum != 5) cells in A.
const nonDefault = [];
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const v = getEnum(a, r, c);
    if (v !== 5) nonDefault.push({ r, c, v });
  }
}
console.log(`\nNon-default cells in A: ${nonDefault.length}`);

// Check diagonal: should be self-cells.
console.log(`\nDiagonal cells (r==c):`);
let diagCounts = {};
for (let r = 0; r < N; r++) {
  const v = getEnum(a, r, r);
  diagCounts[v] = (diagCounts[v] || 0) + 1;
}
for (const [v, c] of Object.entries(diagCounts)) {
  console.log(`  diag enum=${v}: ${c}`);
}

// Print samples of non-default cells.
console.log(`\nFirst 30 non-default cells (not on diagonal):`);
let printed = 0;
for (const { r, c, v } of nonDefault) {
  if (r === c) continue;
  console.log(`  [r=${r}, c=${c}] enum=${v}`);
  printed++;
  if (printed >= 30) break;
}

// 3. Verify the flip: in A check (0,156) and (156,0) — should be 5.
// In B check same cells — should be 1.
console.log(`\n=== VERIFICATION: (Romans=0, Messapians=156) ===`);
console.log(`  A[0][156] = ${getEnum(a, 0, 156)}`);
console.log(`  A[156][0] = ${getEnum(a, 156, 0)}`);
// But B's matrix is shifted in the file because of -10 delta? Actually no — the matrix is BEFORE the shift point.
// The shift point happened around 0x1f1de00 (from session 32 step 3). The matrix is at 0xf8fd2..0xf8fd2+57121*267 = 0xf8fd2 + 15251307 = 0x1ed6e9d. Hmm that's CLOSE to where shift starts. Let me check.
const matEnd = matStart + N * N * stride;
console.log(`Matrix end: 0x${matEnd.toString(16)}`);

console.log(`  B[0][156] = ${getEnum(b, 0, 156)}`);
console.log(`  B[156][0] = ${getEnum(b, 156, 0)}`);

// Also count how many cells differ between A and B in the matrix.
let diffCount = 0;
const diffs = [];
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const va = getEnum(a, r, c);
    const vb = getEnum(b, r, c);
    if (va !== vb) {
      diffCount++;
      diffs.push({ r, c, va, vb });
    }
  }
}
console.log(`\nEnum diffs (A vs B) in matrix: ${diffCount}`);
for (const d of diffs.slice(0, 10)) {
  console.log(`  [r=${d.r}, c=${d.c}] ${d.va} -> ${d.vb}`);
}
