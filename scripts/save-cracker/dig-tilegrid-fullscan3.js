// dig-tilegrid-fullscan3.js — Session 99/C
// Test the hypothesis: F28 byte at +28 marks "map edge cells" (col 239 right
// edge; row 237 bottom; row 0 top; col 0 left). F32 carries movement-cost
// override; F20 mirrors F32 for terrain class.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

const GRID_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;
const N = W * H;

const F20 = new Int32Array(N);
const F28 = new Uint8Array(N);
const F32 = new Int32Array(N);

for (let i = 0; i < N; i++) {
  const b = GRID_START + i * STRIDE;
  F20[i] = buf.readInt32LE(b + 20);
  F28[i] = buf[b + 28];
  F32[i] = buf.readInt32LE(b + 32);
}

// 1. Edge analysis for F28
console.log('Edge analysis for F28 (default=6):');
let edgeRight = 0, edgeLeft = 0, edgeTop = 0, edgeBottom = 0, interior = 0;
let edgeRightNonDef = 0, edgeLeftNonDef = 0, edgeTopNonDef = 0, edgeBottomNonDef = 0, interiorNonDef = 0;
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r * W + c;
    const nd = F28[i] !== 6;
    const isEdge = (r === 0) || (r === H - 1) || (c === 0) || (c === W - 1);
    if (c === W - 1) { edgeRight++; if (nd) edgeRightNonDef++; }
    if (c === 0)     { edgeLeft++;  if (nd) edgeLeftNonDef++; }
    if (r === 0)     { edgeTop++;   if (nd) edgeTopNonDef++; }
    if (r === H - 1) { edgeBottom++;if (nd) edgeBottomNonDef++; }
    if (!isEdge)     { interior++;  if (nd) interiorNonDef++; }
  }
}
console.log(`  right col (c=239): ${edgeRightNonDef}/${edgeRight}`);
console.log(`  left col (c=0):    ${edgeLeftNonDef}/${edgeLeft}`);
console.log(`  top row (r=0):     ${edgeTopNonDef}/${edgeTop}`);
console.log(`  bottom row (r=237):${edgeBottomNonDef}/${edgeBottom}`);
console.log(`  interior:          ${interiorNonDef}/${interior}`);

// Same for F20 and F32
console.log('\nEdge analysis for F20 (default=200):');
let r20 = 0, l20 = 0, t20 = 0, b20 = 0, i20 = 0;
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (F20[i] === 200) continue;
    if (c === W - 1) r20++;
    if (c === 0) l20++;
    if (r === 0) t20++;
    if (r === H - 1) b20++;
    if (c > 0 && c < W - 1 && r > 0 && r < H - 1) i20++;
  }
}
console.log(`  right: ${r20}, left: ${l20}, top: ${t20}, bottom: ${b20}, interior: ${i20}`);

console.log('\nEdge analysis for F32 (default=200):');
let r32 = 0, l32 = 0, t32 = 0, b32 = 0, i32 = 0;
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (F32[i] === 200) continue;
    if (c === W - 1) r32++;
    if (c === 0) l32++;
    if (r === 0) t32++;
    if (r === H - 1) b32++;
    if (c > 0 && c < W - 1 && r > 0 && r < H - 1) i32++;
  }
}
console.log(`  right: ${r32}, left: ${l32}, top: ${t32}, bottom: ${b32}, interior: ${i32}`);

// 2. Are interior F28=54 cells region-boundary related?
// Plot them
console.log('\nInterior F28=54 cells (first 30 with row+col):');
let n = 0;
for (let r = 1; r < H - 1 && n < 30; r++) {
  for (let c = 1; c < W - 1 && n < 30; c++) {
    const i = r * W + c;
    if (F28[i] === 54) {
      console.log(`  [r=${r},c=${c}]  F20=${F20[i]}  F32=${F32[i]}`);
      n++;
    }
  }
}

// 3. Save an ASCII heatmap of F32!=200 for visual inspection
console.log('\nASCII map of F32 (. = 200 default, X = 600, O = 0, - = -10):');
const lines = [];
for (let r = 0; r < H; r++) {
  let line = '';
  for (let c = 0; c < W; c++) {
    const v = F32[r * W + c];
    if (v === 200) line += '.';
    else if (v === 600) line += 'X';
    else if (v === 0) line += 'O';
    else if (v === -10) line += '-';
    else line += '?';
  }
  lines.push(line);
}
// Print every 4th row, every 2nd column for fit
for (let r = 0; r < H; r += 4) {
  let line = '';
  for (let c = 0; c < W; c += 2) line += lines[r][c];
  console.log(line);
}

// Also F28
console.log('\nASCII map of F28 (. = 6 default, X = 54, * = 55):');
const lines28 = [];
for (let r = 0; r < H; r++) {
  let line = '';
  for (let c = 0; c < W; c++) {
    const v = F28[r * W + c];
    if (v === 6) line += '.';
    else if (v === 54) line += 'X';
    else if (v === 55) line += '*';
    else line += '?';
  }
  lines28.push(line);
}
for (let r = 0; r < H; r += 4) {
  let line = '';
  for (let c = 0; c < W; c += 2) line += lines28[r][c];
  console.log(line);
}
