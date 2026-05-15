// dig-tilegrid-fields1.js — Session 43.
// Cross-reference the 6 variable u32 fields per 267-byte record in the
// 240×153 tile-grid at 0x633c50 against 5 static map TGAs.
// Spearman correlation per (field, map) pair; pin > 0.7.

const fs = require('fs');

const SAVE_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE_PATH);

const REC_START = 0x633c50;
const STRIDE = 267;
const W = 240, H = 153;
const N = W * H; // 36720 (file has 36583; tail 137 missing)
const N_AVAIL = 36583;

// --- 1. Extract 6 variable fields per record (offsets per session 35) ---
const FIELDS = [
  { name: 'F20_u32', off: 20, kind: 'u32' },  // 3 distinct: 200/600/0
  { name: 'F28_u32', off: 28, kind: 'u32' },  // 3 distinct: 6/54/55
  { name: 'F32_u32', off: 32, kind: 'i32' },  // 5 distinct: 200/600/0/-10/400
];
// Also probe other byte slots to find any other variable fields
// Per session 35, the variable u32 positions are at +20, +28, +32 (three).
// "6 variable fields" likely means at the byte level. Let's scan to confirm.

console.log('# Scanning record bytes 0..99 to find variable positions...');
const byteDistinct = new Array(100).fill(null).map(() => new Set());
for (let i = 0; i < N_AVAIL; i++) {
  for (let j = 0; j < 100; j++) byteDistinct[j].add(buf[REC_START + i * STRIDE + j]);
}
const variableBytes = [];
for (let j = 0; j < 100; j++) {
  if (byteDistinct[j].size > 1) variableBytes.push({ pos: j, distinct: byteDistinct[j].size });
}
console.log('Variable byte positions in record[0..99]:');
for (const v of variableBytes) console.log(`  +${v.pos}: ${v.distinct} distinct values`);

// Group consecutive variable bytes into u32/u16 fields
console.log('\n# Reading u32 LE at each variable-byte 4-aligned cluster.');
// Re-collect: just sample fields at +20, +28, +32 (we know these from session 35).
// Then also check +21, +22, +23 etc — likely they're high bytes of the same u32.

// Build arrays of (cell_index, field_value) for the 3 known u32 fields.
const tileVals = {}; // name -> Int32Array(N_AVAIL)
for (const f of FIELDS) {
  const arr = new Int32Array(N_AVAIL);
  for (let i = 0; i < N_AVAIL; i++) {
    const p = REC_START + i * STRIDE + f.off;
    arr[i] = f.kind === 'i32' ? buf.readInt32LE(p) : buf.readUInt32LE(p);
  }
  tileVals[f.name] = arr;
  // distinct count
  const set = new Set(arr);
  console.log(`Field ${f.name}: ${set.size} distinct values, range [${Math.min(...set)}..${Math.max(...set)}]`);
}

// --- 2. TGA loader ---
function loadTGA(path) {
  const tga = fs.readFileSync(path);
  const idLen = tga.readUInt8(0);
  const cmapType = tga.readUInt8(1);
  const imgType = tga.readUInt8(2);
  const TGAW = tga.readUInt16LE(12);
  const TGAH = tga.readUInt16LE(14);
  const bpp = tga.readUInt8(16) / 8;
  const desc = tga.readUInt8(17);
  const isTopDown = (desc & 0x20) !== 0;
  const dataStart = 18 + idLen + (cmapType ? tga.readUInt16LE(5) * tga.readUInt8(7) / 8 : 0);
  return { tga, TGAW, TGAH, bpp, isTopDown, dataStart, imgType, path };
}

function pixelAt(tgaObj, x, y) {
  const { tga, TGAW, TGAH, bpp, isTopDown, dataStart } = tgaObj;
  const ry = isTopDown ? y : (TGAH - 1 - y);
  const off = dataStart + (ry * TGAW + x) * bpp;
  if (bpp === 1) return tga[off];
  // bpp 3 or 4: pack BGR -> uint
  return (tga[off + 2] << 16) | (tga[off + 1] << 8) | tga[off];
}

const MAPS = [
  { name: 'ground_types', path: 'C:/dev/Provincia/public/map_ground_types_large.tga' },
  { name: 'heights',      path: 'C:/dev/Provincia/public/map_heights_large.tga' },
  { name: 'regions',      path: 'C:/dev/Provincia/public/map_regions_large.tga' },
  { name: 'climates',     path: 'C:/RIS/RIS/data/world/maps/base/map_climates.tga' },
  { name: 'features',     path: 'C:/RIS/RIS/data/world/maps/base/map_features.tga' },
];

const tgaObjs = {};
for (const m of MAPS) {
  try {
    tgaObjs[m.name] = loadTGA(m.path);
    const o = tgaObjs[m.name];
    console.log(`Loaded ${m.name}: ${o.TGAW}x${o.TGAH} bpp=${o.bpp} imgType=${o.imgType} topdown=${o.isTopDown}`);
  } catch (e) {
    console.log(`  Failed to load ${m.name}: ${e.message}`);
  }
}

// --- 3. Sample TGA values at each tile (cell_index -> tga value) ---
function sampleMap(tgaObj) {
  const arr = new Int32Array(N_AVAIL);
  for (let i = 0; i < N_AVAIL; i++) {
    const col = i % W;
    const row = Math.floor(i / W);
    const px = Math.floor(col * tgaObj.TGAW / W);
    const py = Math.floor(row * tgaObj.TGAH / H);
    arr[i] = pixelAt(tgaObj, px, py);
  }
  return arr;
}

const mapVals = {};
for (const name of Object.keys(tgaObjs)) {
  mapVals[name] = sampleMap(tgaObjs[name]);
  const distinct = new Set(mapVals[name]);
  console.log(`Sampled ${name}: ${distinct.size} distinct values across ${N_AVAIL} cells`);
}

// --- 4. Categorical "correlation" — for each (field, map) pair, compute
//        normalized mutual information style score: for each field-value,
//        find the dominant map-value and report purity. ---
function purityScore(fieldArr, mapArr) {
  // bucket by fieldVal -> map mapVal -> count
  const groups = new Map();
  for (let i = 0; i < fieldArr.length; i++) {
    const fv = fieldArr[i];
    const mv = mapArr[i];
    let inner = groups.get(fv);
    if (!inner) { inner = new Map(); groups.set(fv, inner); }
    inner.set(mv, (inner.get(mv) || 0) + 1);
  }
  // purity = sum over buckets of (max count) / total
  let total = 0, dominantSum = 0;
  const breakdown = [];
  for (const [fv, inner] of groups) {
    let max = 0, sum = 0, dom = null;
    for (const [mv, c] of inner) { sum += c; if (c > max) { max = c; dom = mv; } }
    total += sum; dominantSum += max;
    breakdown.push({ fv, sum, max, dom, pct: max / sum });
  }
  breakdown.sort((a, b) => b.sum - a.sum);
  return { purity: dominantSum / total, breakdown };
}

// Spearman-ish: convert to ranks, compute Pearson. For categorical with few
// values, purity is more meaningful, so we report both.
function pearsonRank(a, b) {
  // For very low-cardinality field arrays, ranks are mostly tied — use simple
  // value-rank.
  // We'll just compute Pearson on raw numeric values (treating BGR-packed as
  // a number which is poor for categorical, but acceptable for monotonic
  // grayscale).
  const n = a.length;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

console.log('\n===== Cross-correlation: field × map =====');
const matrix = [];
for (const fname of Object.keys(tileVals)) {
  for (const mname of Object.keys(mapVals)) {
    const { purity, breakdown } = purityScore(tileVals[fname], mapVals[mname]);
    const r = pearsonRank(tileVals[fname], mapVals[mname]);
    matrix.push({ field: fname, map: mname, purity, r, breakdown });
  }
}

// Sort by purity, descending
matrix.sort((a, b) => b.purity - a.purity);
console.log('Top (field, map) pairs by purity:');
for (const m of matrix) {
  console.log(`  ${m.field.padEnd(10)} x ${m.map.padEnd(14)}  purity=${m.purity.toFixed(3)}  Pearson=${m.r.toFixed(3)}`);
}

// For top 3 pairs, dump the value breakdown
console.log('\n===== Top 3 pairs: value distribution =====');
for (const m of matrix.slice(0, 3)) {
  console.log(`\n[${m.field}] × [${m.map}] purity=${m.purity.toFixed(3)}:`);
  for (const b of m.breakdown.slice(0, 8)) {
    console.log(`  field=${String(b.fv).padStart(6)} (${b.sum} cells) -> dominant map=${typeof b.dom === 'number' ? '0x'+b.dom.toString(16) : b.dom} (${(b.pct*100).toFixed(1)}%)`);
  }
}

// --- 5. Visualize: dump a 240x153 ASCII map of each variable field ---
function dumpFieldMap(arr, label) {
  console.log(`\nASCII map of ${label} (240×153, sampled cols 0..239 step 4, rows 0..152 step 4):`);
  const set = [...new Set(arr)].sort((a, b) => a - b);
  const lookup = new Map(set.map((v, i) => [v, i]));
  const chars = ' .:-=+*#%@'.split('');
  for (let row = 0; row < 153; row += 4) {
    let line = '';
    for (let col = 0; col < 240; col += 2) {
      const i = row * 240 + col;
      if (i >= N_AVAIL) { line += '?'; continue; }
      const v = arr[i];
      const idx = lookup.get(v) || 0;
      line += chars[Math.min(idx, chars.length - 1)];
    }
    console.log(line);
  }
}

for (const f of FIELDS) dumpFieldMap(tileVals[f.name], f.name);

// Also: try Y-axis flip — RTW saves are often bottom-up
console.log('\n===== Trying Y-FLIP sampling on top-2 pairs =====');
function sampleMapFlipY(tgaObj) {
  const arr = new Int32Array(N_AVAIL);
  for (let i = 0; i < N_AVAIL; i++) {
    const col = i % W;
    const row = Math.floor(i / W);
    const flipRow = (H - 1) - row;
    const px = Math.floor(col * tgaObj.TGAW / W);
    const py = Math.floor(flipRow * tgaObj.TGAH / H);
    arr[i] = pixelAt(tgaObj, px, py);
  }
  return arr;
}
const flipMatrix = [];
for (const fname of Object.keys(tileVals)) {
  for (const mname of Object.keys(tgaObjs)) {
    const flipped = sampleMapFlipY(tgaObjs[mname]);
    const { purity } = purityScore(tileVals[fname], flipped);
    flipMatrix.push({ field: fname, map: mname, purity });
  }
}
flipMatrix.sort((a, b) => b.purity - a.purity);
for (const m of flipMatrix.slice(0, 10)) {
  console.log(`  Y-flip ${m.field.padEnd(10)} x ${m.map.padEnd(14)}  purity=${m.purity.toFixed(3)}`);
}
