// Session 52, attempt 2: characterize the +32 200→195 transition pattern.
// Hypothesis from attempt 1: changed cells form an anti-diagonal triangle.
// Check whether the change pattern correlates with linear cell-index or with
// some scan-line algorithm (e.g. flood fill from a starting tile, or a
// pathfinder cost map).

const fs = require('fs');

const T1_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const T2_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 2 Start.sav';
const T1 = fs.readFileSync(T1_PATH);
const T2 = fs.readFileSync(T2_PATH);

const STRIDE = 267;
const W = 240, H = 238;
const N = W * H;
const T1_START = 0xf8fd2;
const T2_START = 0xf913d;

// Build F32 (the +32 field) for both turns
const F1 = new Int32Array(N), F2 = new Int32Array(N);
for (let i = 0; i < N; i++) {
  F1[i] = T1.readInt32LE(T1_START + i * STRIDE + 32);
  F2[i] = T2.readInt32LE(T2_START + i * STRIDE + 32);
}

// Hypothesis: +32 was T1=200 default, T2=195 default. Default shifted by -5.
// All cells with T1[i]=200 should be T2[i]=195 if the shift is global.
let n200_in_T1 = 0, n200to195 = 0, n200unchanged = 0, n200to_other = 0;
for (let i = 0; i < N; i++) {
  if (F1[i] === 200) {
    n200_in_T1++;
    if (F2[i] === 195) n200to195++;
    else if (F2[i] === 200) n200unchanged++;
    else n200to_other++;
  }
}
console.log(`Cells where T1[+32]=200: ${n200_in_T1}`);
console.log(`  -> T2=195: ${n200to195}`);
console.log(`  -> T2=200 (unchanged): ${n200unchanged}`);
console.log(`  -> T2=other: ${n200to_other}`);
console.log(`  Fraction shifted: ${(n200to195/n200_in_T1*100).toFixed(2)}%`);

// Are the n200unchanged cells geographically clustered?
// Print a (col, row) histogram.
const unchanged200 = [];
for (let i = 0; i < N; i++) {
  if (F1[i] === 200 && F2[i] === 200) unchanged200.push(i);
}
console.log(`\nUnchanged-200 cells: ${unchanged200.length}`);
// Find min/max row, col
let minR = H, maxR = 0, minC = W, maxC = 0;
for (const i of unchanged200) {
  const r = Math.floor(i / W), c = i % W;
  minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  minC = Math.min(minC, c); maxC = Math.max(maxC, c);
}
console.log(`Unchanged-200 bounding box: rows [${minR}..${maxR}], cols [${minC}..${maxC}]`);

// Linear-index range
let minIdx = N, maxIdx = 0;
for (const i of unchanged200) {
  minIdx = Math.min(minIdx, i); maxIdx = Math.max(maxIdx, i);
}
console.log(`Unchanged-200 index range: [${minIdx}..${maxIdx}]`);

// Histogram by row of unchanged
const byRow = new Array(H).fill(0);
for (const i of unchanged200) byRow[Math.floor(i / W)]++;
console.log('\nUnchanged-200 cells by row (only rows >0):');
for (let r = 0; r < H; r++) if (byRow[r] > 0) console.log(`  row ${r}: ${byRow[r]}`);

// Now characterize the changed cells: are they CONTIGUOUS from index 0 to N/2?
// Build a "change" boolean array and see longest run from start.
const changed = new Array(N);
for (let i = 0; i < N; i++) changed[i] = (F1[i] === 200 && F2[i] === 195);
// Cumulative count
let cum = 0;
const cumArr = new Int32Array(N + 1);
for (let i = 0; i < N; i++) { cumArr[i] = cum; cum += changed[i] ? 1 : 0; }
cumArr[N] = cum;

// At what index does the cumulative count reach 50%?
const half = Math.floor(n200to195 / 2);
let halfIdx = 0;
for (let i = 0; i < N; i++) if (cumArr[i] >= half) { halfIdx = i; break; }
console.log(`\nCumulative changed=${n200to195}; reaches 50% at index ${halfIdx} (which is row ${Math.floor(halfIdx/W)}, col ${halfIdx%W})`);

// What's the change ratio in first half vs second half of array?
let h1c = 0, h2c = 0, h1t = 0, h2t = 0;
for (let i = 0; i < N; i++) {
  if (F1[i] === 200) {
    if (i < N / 2) { h1t++; if (changed[i]) h1c++; }
    else { h2t++; if (changed[i]) h2c++; }
  }
}
console.log(`First-half-of-array (idx<${N/2}) 200-cells: ${h1c}/${h1t} = ${(h1c/h1t*100).toFixed(1)}% changed`);
console.log(`Second-half: ${h2c}/${h2t} = ${(h2c/h2t*100).toFixed(1)}% changed`);

// === Try cumulative on a different ordering: column-major instead of row-major?
// If the engine stores cells row-by-row but processes col-by-col, the "change
// pattern" could be col-major-cumulative.
// Sort by (col, row) — i.e. col-major index.
const colMajor = new Int32Array(N);
for (let i = 0; i < N; i++) {
  const r = Math.floor(i / W), c = i % W;
  colMajor[c * H + r] = changed[i] ? 1 : 0;
}
// Find longest run from start
let firstUnchanged = -1;
for (let k = 0; k < N; k++) {
  if (colMajor[k] === 0 && firstUnchanged === -1) { firstUnchanged = k; break; }
}
console.log(`\nCol-major: first unchanged at col-major-idx ${firstUnchanged} (col=${Math.floor(firstUnchanged/H)}, row=${firstUnchanged%H})`);

// === Geographic explanation: maybe changed cells = cells in T2 that the engine
// VISITED during turn-2-start preprocessing. Check if changed cells correlate
// with character positions.
// For now: just print a fine-grained map of where unchanged cells lie.
console.log('\n=== Fine-grained map of +32-CHANGED-200->195 cells (Y-flipped) ===');
console.log('(. = T1=200,T2=200 unchanged; X = T1=200,T2=195; * = T1!=200; ! = other transition)');
for (let row = 0; row < H; row += 2) {
  let line = '';
  for (let col = 0; col < W; col += 2) {
    const i = row * W + col;
    if (F1[i] !== 200) line += '*';
    else if (F2[i] === 195) line += 'X';
    else if (F2[i] === 200) line += '.';
    else line += '!';
  }
  console.log(line);
}

// === Final: report rows where the change is EXACTLY the same as a perfect
// triangle (all cells before col K changed, all cells from col K unchanged).
console.log('\n=== Per-row "boundary col" analysis ===');
console.log('row | first-unchanged-col | last-changed-col | # changed in row');
for (let r = 0; r < H; r += 8) {
  let firstU = -1, lastC = -1, nc = 0;
  for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (F1[i] === 200 && F2[i] === 195) { lastC = c; nc++; }
    if (F1[i] === 200 && F2[i] === 200 && firstU === -1) firstU = c;
  }
  console.log(`${r.toString().padStart(3)} | ${firstU.toString().padStart(8)} | ${lastC.toString().padStart(8)} | ${nc}`);
}

// === Compare the 16 +20 200->600 cells with the +32 changes — same cells?
let p20Changes = [];
for (let i = 0; i < N; i++) {
  const v1 = T1.readUInt32LE(T1_START + i * STRIDE + 20);
  const v2 = T2.readUInt32LE(T2_START + i * STRIDE + 20);
  if (v1 !== v2) p20Changes.push({ i, v1, v2, row: Math.floor(i / W), col: i % W });
}
console.log(`\n+20 changes: ${p20Changes.length}`);
for (const p of p20Changes) {
  const f32_1 = F1[p.i], f32_2 = F2[p.i];
  console.log(`  cell ${p.i} (col ${p.col}, row ${p.row}): +20: ${p.v1}->${p.v2}, +32: ${f32_1}->${f32_2}`);
}

// And +40 (0->1) changes — where are they?
let p40Changes = [];
for (let i = 0; i < N; i++) {
  const v1 = T1.readUInt32LE(T1_START + i * STRIDE + 40);
  const v2 = T2.readUInt32LE(T2_START + i * STRIDE + 40);
  if (v1 !== v2) p40Changes.push({ i, row: Math.floor(i / W), col: i % W });
}
console.log(`\n+40 changes (210 expected): ${p40Changes.length}`);
// Geographic clustering
const rowHist40 = new Array(H).fill(0), colHist40 = new Array(W).fill(0);
for (const p of p40Changes) { rowHist40[p.row]++; colHist40[p.col]++; }
const hotR40 = rowHist40.map((c, r) => ({ r, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
console.log(`Hot rows for +40 (sorted): ${hotR40.slice(0, 12).map(x => `r${x.r}=${x.c}`).join(', ')}`);

// And +44 (0->1)
let p44Changes = [];
for (let i = 0; i < N; i++) {
  const v1 = T1.readUInt32LE(T1_START + i * STRIDE + 44);
  const v2 = T2.readUInt32LE(T2_START + i * STRIDE + 44);
  if (v1 !== v2) p44Changes.push({ i, row: Math.floor(i / W), col: i % W });
}
console.log(`\n+44 changes (492 expected): ${p44Changes.length}`);
const rowHist44 = new Array(H).fill(0);
for (const p of p44Changes) rowHist44[p.row]++;
const hotR44 = rowHist44.map((c, r) => ({ r, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
console.log(`Hot rows for +44 (sorted): ${hotR44.slice(0, 12).map(x => `r${x.r}=${x.c}`).join(', ')}`);
