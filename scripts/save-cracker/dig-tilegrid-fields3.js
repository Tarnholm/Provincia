// dig-tilegrid-fields3.js — Hypothesis: non-default cells are REGION BOUNDARY
// markers (i.e. they sit on the EDGE between two regions in map_regions.tga,
// not on the interior). Test: a cell is "on a border" if its 4-neighbour
// cells in map_regions.tga have differing region colors.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

const REC_START = 0x633c50;
const STRIDE = 267;
const W = 240, H = 153;
const N_AVAIL = 36583;

function field(off, kind) {
  const arr = new Int32Array(N_AVAIL);
  for (let i = 0; i < N_AVAIL; i++) {
    const p = REC_START + i * STRIDE + off;
    arr[i] = kind === 'i' ? buf.readInt32LE(p) : buf.readUInt32LE(p);
  }
  return arr;
}
const F20 = field(20);
const F28 = field(28);
const F32 = field(32, 'i');

// Load regions TGA
function loadTGA(path) {
  const tga = fs.readFileSync(path);
  const idLen = tga.readUInt8(0);
  const cmapType = tga.readUInt8(1);
  const TGAW = tga.readUInt16LE(12);
  const TGAH = tga.readUInt16LE(14);
  const bpp = tga.readUInt8(16) / 8;
  const desc = tga.readUInt8(17);
  const isTopDown = (desc & 0x20) !== 0;
  const dataStart = 18 + idLen + (cmapType ? tga.readUInt16LE(5) * tga.readUInt8(7) / 8 : 0);
  return { tga, TGAW, TGAH, bpp, isTopDown, dataStart };
}
function pix(t, x, y) {
  const ry = t.isTopDown ? y : (t.TGAH - 1 - y);
  const off = t.dataStart + (ry * t.TGAW + x) * t.bpp;
  return (t.tga[off + 2] << 16) | (t.tga[off + 1] << 8) | t.tga[off];
}
const regions = loadTGA('C:/dev/Provincia/public/map_regions_large.tga');

// For each cell (col, row) in the 240x153 grid, compute the 4 corners of its
// pixel block in regions.tga. Cell is a "boundary cell" if those corners
// have differing region colors.
function cellBlockColors(col, row, flipY = false) {
  const r = flipY ? (H - 1 - row) : row;
  const x0 = Math.floor(col * regions.TGAW / W);
  const x1 = Math.floor((col + 1) * regions.TGAW / W) - 1;
  const y0 = Math.floor(r * regions.TGAH / H);
  const y1 = Math.floor((r + 1) * regions.TGAH / H) - 1;
  const colors = new Set();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      colors.add(pix(regions, x, y));
    }
  }
  return colors;
}

// Stat 1: for ALL cells (default and non-default), is the cell on a region boundary?
let onBoundaryAll = 0, totalAll = 0;
let boundaryNonDef = { F20: 0, F28: 0, F32: 0 };
let countNonDef = { F20: 0, F28: 0, F32: 0 };
let boundaryDef = { F20: 0, F28: 0, F32: 0 };
let countDef = { F20: 0, F28: 0, F32: 0 };

for (let i = 0; i < N_AVAIL; i++) {
  const col = i % W;
  const row = Math.floor(i / W);
  const colors = cellBlockColors(col, row, true);  // Y-flipped (since save row 0 = south?)
  const isBoundary = colors.size > 1;
  totalAll++;
  if (isBoundary) onBoundaryAll++;
  for (const [name, arr, def] of [['F20', F20, 200], ['F28', F28, 6], ['F32', F32, 200]]) {
    if (arr[i] === def) { countDef[name]++; if (isBoundary) boundaryDef[name]++; }
    else { countNonDef[name]++; if (isBoundary) boundaryNonDef[name]++; }
  }
}

console.log(`Total cells: ${totalAll}, on boundary: ${onBoundaryAll} (${(onBoundaryAll/totalAll*100).toFixed(1)}%) [baseline]`);
console.log('Per-field non-default-vs-default boundary rate:');
for (const n of ['F20', 'F28', 'F32']) {
  const ndRate = boundaryNonDef[n] / countNonDef[n];
  const dRate = boundaryDef[n] / countDef[n];
  console.log(`  ${n}: non-default ${boundaryNonDef[n]}/${countNonDef[n]} = ${(ndRate*100).toFixed(1)}%; default ${boundaryDef[n]}/${countDef[n]} = ${(dRate*100).toFixed(1)}%; lift = ${(ndRate/dRate).toFixed(2)}x`);
}

// Also: is the F28=54 col-101 stripe on a vertical region boundary in regions.tga?
// Map col 101 to TGA x range.
const xMin = Math.floor(101 * regions.TGAW / W);
const xMax = Math.floor(102 * regions.TGAW / W) - 1;
console.log(`\nCol 101 maps to regions.tga x = ${xMin}..${xMax}`);

// Walk down this strip and count unique colors vs rows.
const colsInStrip = new Set();
for (let y = 0; y < regions.TGAH; y++) {
  for (let x = xMin; x <= xMax; x++) {
    colsInStrip.add(pix(regions, x, y));
  }
}
console.log(`  Strip col 101 has ${colsInStrip.size} distinct region colors across all rows`);

// Same test for ground_types
const ground = loadTGA('C:/dev/Provincia/public/map_ground_types_large.tga');
function cellGroundColors(col, row, flipY = true) {
  const r = flipY ? (H - 1 - row) : row;
  const x0 = Math.floor(col * ground.TGAW / W);
  const x1 = Math.floor((col + 1) * ground.TGAW / W) - 1;
  const y0 = Math.floor(r * ground.TGAH / H);
  const y1 = Math.floor((r + 1) * ground.TGAH / H) - 1;
  const colors = new Set();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      colors.add(pix(ground, x, y));
    }
  }
  return colors;
}

let groundBoundaryAll = 0, groundBNonDef = { F20: 0, F28: 0, F32: 0 }, groundBDef = { F20: 0, F28: 0, F32: 0 };
for (let i = 0; i < N_AVAIL; i++) {
  const col = i % W;
  const row = Math.floor(i / W);
  const colors = cellGroundColors(col, row, true);
  const isB = colors.size > 1;
  if (isB) groundBoundaryAll++;
  for (const [name, arr, def] of [['F20', F20, 200], ['F28', F28, 6], ['F32', F32, 200]]) {
    if (arr[i] === def) { if (isB) groundBDef[name]++; }
    else { if (isB) groundBNonDef[name]++; }
  }
}
console.log(`\nGround-types boundary cells: ${groundBoundaryAll}/${totalAll} (${(groundBoundaryAll/totalAll*100).toFixed(1)}%)`);
for (const n of ['F20', 'F28', 'F32']) {
  const ndRate = groundBNonDef[n] / countNonDef[n];
  const dRate = groundBDef[n] / countDef[n];
  console.log(`  ${n}: non-default ${groundBNonDef[n]}/${countNonDef[n]} = ${(ndRate*100).toFixed(1)}%; default = ${(dRate*100).toFixed(1)}%; lift = ${(ndRate/dRate).toFixed(2)}x`);
}

// And for heights — boundary of altitude bands
const heights = loadTGA('C:/dev/Provincia/public/map_heights_large.tga');
function cellHeightRange(col, row, flipY = true) {
  const r = flipY ? (H - 1 - row) : row;
  const x0 = Math.floor(col * heights.TGAW / W);
  const x1 = Math.floor((col + 1) * heights.TGAW / W) - 1;
  const y0 = Math.floor(r * heights.TGAH / H);
  const y1 = Math.floor((r + 1) * heights.TGAH / H) - 1;
  let min = 256, max = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const v = heights.tga[heights.dataStart + ((heights.TGAH - 1 - y) * heights.TGAW + x) * 3];
      if (v < min) min = v; if (v > max) max = v;
    }
  }
  return { min, max, range: max - min };
}
let hMaxRange = { F20nd: 0, F20d: 0, F28nd: 0, F28d: 0, F32nd: 0, F32d: 0 };
let hN = { F20nd: 0, F20d: 0, F28nd: 0, F28d: 0, F32nd: 0, F32d: 0 };
for (let i = 0; i < N_AVAIL; i++) {
  const col = i % W;
  const row = Math.floor(i / W);
  const { range } = cellHeightRange(col, row, true);
  for (const [name, arr, def] of [['F20', F20, 200], ['F28', F28, 6], ['F32', F32, 200]]) {
    if (arr[i] === def) { hMaxRange[`${name}d`] += range; hN[`${name}d`]++; }
    else { hMaxRange[`${name}nd`] += range; hN[`${name}nd`]++; }
  }
}
console.log('\nMean height-range within cell-block:');
for (const n of ['F20', 'F28', 'F32']) {
  const nd = hMaxRange[`${n}nd`] / hN[`${n}nd`];
  const d = hMaxRange[`${n}d`] / hN[`${n}d`];
  console.log(`  ${n}: non-default mean range = ${nd.toFixed(2)}, default = ${d.toFixed(2)}, lift = ${(nd/d).toFixed(2)}x`);
}

// Visualization: print 240x153 map with F20-non-default = X, region-boundary = +, both = #
console.log('\n===== Spatial map of F20 non-default vs region-boundary (Y-flipped) =====');
console.log('(., default ; + boundary only ; X non-default only ; # both ; sampled cols step 3, rows step 3)');
for (let row = 0; row < H; row += 3) {
  let line = '';
  for (let col = 0; col < W; col += 3) {
    const i = row * W + col;
    if (i >= N_AVAIL) { line += '?'; continue; }
    const isND = F20[i] !== 200;
    const colors = cellBlockColors(col, row, true);
    const isB = colors.size > 1;
    if (isND && isB) line += '#';
    else if (isND)   line += 'X';
    else if (isB)    line += '+';
    else             line += '.';
  }
  console.log(line);
}

// Print map with F28-non-default + ground-type-boundary
console.log('\n===== F28 non-default vs ground-types-boundary (Y-flipped, step 3) =====');
for (let row = 0; row < H; row += 3) {
  let line = '';
  for (let col = 0; col < W; col += 3) {
    const i = row * W + col;
    if (i >= N_AVAIL) { line += '?'; continue; }
    const isND = F28[i] !== 6;
    const colors = cellGroundColors(col, row, true);
    const isB = colors.size > 1;
    if (isND && isB) line += '#';
    else if (isND)   line += 'X';
    else if (isB)    line += '+';
    else             line += '.';
  }
  console.log(line);
}
