// dig-tilegrid-turn-diff1.js — Session 52
// Diff the 240×238 tile-grid between save_1.2 (T1) and Turn 2 Start (T2).
// T1: 0xf8fd2, 57120 records, stride 267
// T2: 0xf913d, 57120 records, stride 267

const fs = require('fs');

const T1_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const T2_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 2 Start.sav';

const T1 = fs.readFileSync(T1_PATH);
const T2 = fs.readFileSync(T2_PATH);

const STRIDE = 267;
const W = 240, H = 238;
const N = W * H; // 57120

const T1_START = 0xf8fd2;
const T2_START = 0xf913d;

console.log(`T1 grid: 0x${T1_START.toString(16)}, T2 grid: 0x${T2_START.toString(16)}, N=${N} records`);

// === Per-offset change scan ===
console.log('\n=== Per-u32-offset change count ===');
const changedOffsets = [];
let totalDiffU32 = 0;
for (let off = 0; off + 4 <= STRIDE; off += 4) {
  let nChanged = 0;
  // For non-trivial offsets, also count NON-CONSTANT diffs (where T1, T2 are both > 0)
  for (let i = 0; i < N; i++) {
    const v1 = T1.readUInt32LE(T1_START + i * STRIDE + off);
    const v2 = T2.readUInt32LE(T2_START + i * STRIDE + off);
    if (v1 !== v2) nChanged++;
  }
  if (nChanged > 0) {
    changedOffsets.push({ off, nChanged });
    totalDiffU32 += nChanged;
  }
}
console.log('off | nChanged (out of 57120) | %');
for (const r of changedOffsets) {
  console.log(`+${r.off.toString().padStart(3)} | ${r.nChanged.toString().padStart(8)} | ${(r.nChanged/N*100).toFixed(2)}%`);
}
console.log(`Total diff u32 reads: ${totalDiffU32}`);

// Identify "global" offsets (changed in ~all records — likely version constants)
// vs "per-cell" offsets (changed in <50% — likely real per-tile state).
const GLOBAL_THRESHOLD = N * 0.95;
const globalOffsets = changedOffsets.filter(r => r.nChanged >= GLOBAL_THRESHOLD).map(r => r.off);
const perCellOffsets = changedOffsets.filter(r => r.nChanged < GLOBAL_THRESHOLD).map(r => r.off);

console.log(`\nGlobal (>=95%-of-records) offsets: ${globalOffsets.map(o => '+' + o).join(', ')}`);
console.log(`Per-cell (<95%) offsets: ${perCellOffsets.map(o => '+' + o).join(', ')}`);

// For each per-cell offset, deep dive
for (const off of perCellOffsets) {
  console.log(`\n--- Per-cell offset +${off} ---`);
  const F1 = new Int32Array(N), F2 = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    F1[i] = T1.readInt32LE(T1_START + i * STRIDE + off);
    F2[i] = T2.readInt32LE(T2_START + i * STRIDE + off);
  }
  // Value distributions
  const d1 = new Map(), d2 = new Map();
  for (let i = 0; i < N; i++) {
    d1.set(F1[i], (d1.get(F1[i]) || 0) + 1);
    d2.set(F2[i], (d2.get(F2[i]) || 0) + 1);
  }
  console.log(`  T1 distinct: ${d1.size}; top: ${[...d1.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>`${v}=${c}`).join(', ')}`);
  console.log(`  T2 distinct: ${d2.size}; top: ${[...d2.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>`${v}=${c}`).join(', ')}`);
  // Transitions
  const trans = new Map();
  let nC = 0;
  for (let i = 0; i < N; i++) {
    if (F1[i] !== F2[i]) {
      nC++;
      const k = `${F1[i]}->${F2[i]}`;
      trans.set(k, (trans.get(k) || 0) + 1);
    }
  }
  console.log(`  ${nC} cells changed`);
  const topT = [...trans.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
  console.log(`  Top transitions:`);
  for (const [k, c] of topT) console.log(`    ${k}: ${c}`);
}

// === Global cell-mask: which cells changed at ANY per-cell offset ===
const cellMasks = new Uint32Array(N);
for (let fi = 0; fi < perCellOffsets.length; fi++) {
  const off = perCellOffsets[fi];
  for (let i = 0; i < N; i++) {
    if (T1.readUInt32LE(T1_START + i * STRIDE + off) !== T2.readUInt32LE(T2_START + i * STRIDE + off)) {
      cellMasks[i] |= (1 << fi);
    }
  }
}
let nAnyChanged = 0;
for (let i = 0; i < N; i++) if (cellMasks[i] !== 0) nAnyChanged++;
console.log(`\nCells with ANY per-cell change: ${nAnyChanged} (${(nAnyChanged/N*100).toFixed(2)}%)`);

// Distribution of changed-fields-mask
const maskDist = new Map();
for (let i = 0; i < N; i++) if (cellMasks[i] !== 0) maskDist.set(cellMasks[i], (maskDist.get(cellMasks[i]) || 0) + 1);
console.log('Top change-masks:');
for (const [m, c] of [...maskDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  const flds = perCellOffsets.filter((_, fi) => m & (1 << fi)).map(o => '+' + o);
  console.log(`  mask ${m.toString(2).padStart(perCellOffsets.length, '0')} (${flds.join(',')}): ${c} cells`);
}

// === Geographic distribution ===
console.log('\n=== Geographic distribution of changes ===');
const cR = new Array(H).fill(0);
const cC = new Array(W).fill(0);
for (let i = 0; i < N; i++) {
  if (cellMasks[i] !== 0) {
    cR[Math.floor(i / W)]++;
    cC[i % W]++;
  }
}
const mR = nAnyChanged / H, mC = nAnyChanged / W;
console.log(`Mean per row = ${mR.toFixed(1)}; mean per col = ${mC.toFixed(1)}`);
console.log(`Hot rows (>3x mean):`);
const hotR = cR.map((c, r) => ({ r, c })).filter(x => x.c > mR * 3).sort((a,b)=>b.c-a.c);
for (const h of hotR.slice(0, 10)) console.log(`  row ${h.r}: ${h.c}`);
console.log(`Hot cols (>3x mean):`);
const hotC = cC.map((c, col) => ({ col, c })).filter(x => x.c > mC * 3).sort((a,b)=>b.c-a.c);
for (const h of hotC.slice(0, 10)) console.log(`  col ${h.col}: ${h.c}`);

// Spatial map (Y-flipped, step 3)
console.log('\n=== Spatial map of any-change cells (Y-flipped, step 3) ===');
console.log('(., unchanged ; X any change)');
for (let row = 0; row < H; row += 3) {
  let line = '';
  for (let col = 0; col < W; col += 3) {
    const i = row * W + col;
    line += cellMasks[i] !== 0 ? 'X' : '.';
  }
  console.log(line);
}

// === Did the GLOBAL offsets change deterministically? ===
console.log('\n=== Sample global-offset changes (5 cells) ===');
for (const off of globalOffsets.slice(0, 8)) {
  console.log(`+${off}:`);
  for (let i = 0; i < N; i += Math.floor(N / 5)) {
    const v1 = T1.readInt32LE(T1_START + i * STRIDE + off);
    const v2 = T2.readInt32LE(T2_START + i * STRIDE + off);
    console.log(`  cell ${i}: ${v1} -> ${v2}`);
  }
}

// === Are global offsets uniform (=> turn counter) ? ===
console.log('\n=== Uniformity of global offsets ===');
for (const off of globalOffsets) {
  let allSameT1 = true, allSameT2 = true;
  const v1_0 = T1.readInt32LE(T1_START + off);
  const v2_0 = T2.readInt32LE(T2_START + off);
  for (let i = 1; i < N; i++) {
    if (T1.readInt32LE(T1_START + i * STRIDE + off) !== v1_0) allSameT1 = false;
    if (T2.readInt32LE(T2_START + i * STRIDE + off) !== v2_0) allSameT2 = false;
    if (!allSameT1 && !allSameT2) break;
  }
  console.log(`+${off}: T1 uniform=${allSameT1} (=${v1_0}), T2 uniform=${allSameT2} (=${v2_0})`);
}
