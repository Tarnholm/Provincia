// dig-tilegrid-fields2.js — sharper analysis: focus on NON-DEFAULT cells.
// For each non-default cell in each variable field, compute the dominant
// map value AMONG NON-DEFAULT cells. Then verify by checking whether
// non-default cells form a contiguous spatial structure that matches any map.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAVE);

const REC_START = 0x633c50;
const STRIDE = 267;
const W = 240, H = 153;
const N_AVAIL = 36583;

// Defaults per session 35.
const DEFAULTS = { F20: 200, F28: 6, F32: 200 };

// Extract fields including some byte-level ones (the variable-byte scan showed
// +16, +17, +33, +34 etc are also variable — those might be parts of u16 or
// individual flags).
const fields = {};
function getField(off, kind) {
  const arr = new Int32Array(N_AVAIL);
  for (let i = 0; i < N_AVAIL; i++) {
    const p = REC_START + i * STRIDE + off;
    if (kind === 'u8')  arr[i] = buf[p];
    else if (kind === 'u16') arr[i] = buf.readUInt16LE(p);
    else if (kind === 'i32') arr[i] = buf.readInt32LE(p);
    else                arr[i] = buf.readUInt32LE(p);
  }
  return arr;
}

fields.F20 = getField(20, 'u32');
fields.F28 = getField(28, 'u32');
fields.F32 = getField(32, 'i32');

// --- TGA loader (same as fields1) ---
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
  // If RLE (imgType 10), decode to a flat array. Otherwise reference directly.
  let pixels = null;
  if (imgType === 10) {
    pixels = Buffer.alloc(TGAW * TGAH * bpp);
    let src = dataStart;
    let dst = 0;
    while (dst < pixels.length && src < tga.length) {
      const hdr = tga[src++];
      const count = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        // RLE
        for (let k = 0; k < count; k++) {
          for (let bb = 0; bb < bpp; bb++) pixels[dst + bb] = tga[src + bb];
          dst += bpp;
        }
        src += bpp;
      } else {
        // raw
        for (let k = 0; k < count * bpp; k++) pixels[dst + k] = tga[src + k];
        src += count * bpp;
        dst += count * bpp;
      }
    }
  } else {
    pixels = tga.slice(dataStart, dataStart + TGAW * TGAH * bpp);
  }
  return { pixels, TGAW, TGAH, bpp, isTopDown };
}

function pixelAt(tgaObj, x, y) {
  const { pixels, TGAW, TGAH, bpp, isTopDown } = tgaObj;
  const ry = isTopDown ? y : (TGAH - 1 - y);
  const off = (ry * TGAW + x) * bpp;
  if (bpp === 1) return pixels[off];
  return (pixels[off + 2] << 16) | (pixels[off + 1] << 8) | pixels[off];
}

const MAPS = {
  ground_types: 'C:/dev/Provincia/public/map_ground_types_large.tga',
  heights:      'C:/dev/Provincia/public/map_heights_large.tga',
  regions:      'C:/dev/Provincia/public/map_regions_large.tga',
  climates:     'C:/RIS/RIS/data/world/maps/base/map_climates.tga',
  features:     'C:/RIS/RIS/data/world/maps/base/map_features.tga',
};
const tgas = {};
for (const [k, p] of Object.entries(MAPS)) {
  try { tgas[k] = loadTGA(p); }
  catch (e) { console.log(`miss ${k}: ${e.message}`); }
}

// Sample TGAs at all cells AND flipped-Y
function sampleMap(tga, flipY = false) {
  const arr = new Int32Array(N_AVAIL);
  for (let i = 0; i < N_AVAIL; i++) {
    const col = i % W;
    const row = Math.floor(i / W);
    const r = flipY ? (H - 1 - row) : row;
    const px = Math.floor(col * tga.TGAW / W);
    const py = Math.floor(r * tga.TGAH / H);
    arr[i] = pixelAt(tga, px, py);
  }
  return arr;
}

// Approach: for each (field, map), GROUP cells by (field default vs not default)
// and report the distribution of map values for each group.
// If field encodes the map, then (field == default) and (field != default)
// should have starkly different map-value distributions.
function discriminationScore(fieldArr, defaultVal, mapArr) {
  // Count map values for default-field cells and non-default-field cells.
  const dHist = new Map(), nHist = new Map();
  let dN = 0, nN = 0;
  for (let i = 0; i < fieldArr.length; i++) {
    const m = mapArr[i];
    if (fieldArr[i] === defaultVal) { dHist.set(m, (dHist.get(m) || 0) + 1); dN++; }
    else                            { nHist.set(m, (nHist.get(m) || 0) + 1); nN++; }
  }
  // For each map value present in EITHER group, compute the relative
  // frequency difference. KL-divergence-ish.
  const allKeys = new Set([...dHist.keys(), ...nHist.keys()]);
  let kl = 0;
  for (const k of allKeys) {
    const pD = (dHist.get(k) || 0) / Math.max(dN, 1);
    const pN = (nHist.get(k) || 0) / Math.max(nN, 1);
    if (pN > 0 && pD > 0) kl += pN * Math.log(pN / pD);
    else if (pN > 0) kl += pN * Math.log(pN / 1e-9);
  }
  // Top map values for non-default cells
  const nSorted = [...nHist.entries()].sort((a, b) => b[1] - a[1]);
  const dSorted = [...dHist.entries()].sort((a, b) => b[1] - a[1]);
  return { kl, nN, dN, nTop: nSorted.slice(0, 5), dTop: dSorted.slice(0, 3) };
}

console.log('===== Per-field non-default cell analysis =====');
for (const [fname, arr] of Object.entries(fields)) {
  const def = DEFAULTS[fname];
  const nonDef = [];
  for (let i = 0; i < arr.length; i++) if (arr[i] !== def) nonDef.push(i);
  console.log(`\nField ${fname}: ${nonDef.length} non-default cells (default=${def}); ${arr.length - nonDef.length} default.`);
  // Distinct values
  const distinct = new Map();
  for (const i of nonDef) distinct.set(arr[i], (distinct.get(arr[i]) || 0) + 1);
  console.log(`  Non-default value histogram: ${[...distinct.entries()].sort((a,b)=>b[1]-a[1]).map(([v,c])=>`${v}×${c}`).join(', ')}`);

  // For each map (Y-flip and not), see how much the non-default cells
  // concentrate on specific map values.
  for (const [mname, tga] of Object.entries(tgas)) {
    for (const flipY of [false, true]) {
      const mapArr = sampleMap(tga, flipY);
      const { kl, nTop, dTop } = discriminationScore(arr, def, mapArr);
      const flag = flipY ? 'flipY' : '     ';
      console.log(`  ${mname.padEnd(13)} ${flag} KL=${kl.toFixed(3)}  nonDef-top: ${nTop.map(([v,c])=>`0x${v.toString(16)}×${c}`).join(', ')}`);
    }
  }
}

// --- Sanity: print a 2D map of where field values are non-default for each field
// AND a 2D map of where each TGA has its dominant non-#0 color. ---
console.log('\n===== Spatial overlay: F20 non-default cells vs each map (Y-flipped, since RTW maps are bottom-up but row 0 may be NORTH or SOUTH) =====');

// Build a (col, row) list for F20 non-default
function nonDefCoords(arr, def) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== def) out.push({ col: i % W, row: Math.floor(i / W), v: arr[i], i });
  }
  return out;
}

const f20nd = nonDefCoords(fields.F20, 200);
const f28nd = nonDefCoords(fields.F28, 6);
const f32nd = nonDefCoords(fields.F32, 200);

// Print a 240x153 ASCII map, with two overlays: ground_types and F20-nondefault
console.log('\n--- F20 non-default overlay (X=value, .=default, sea-blue=0x004db4 in ground_types, sampled step 4) ---');
const groundFlipped = sampleMap(tgas.ground_types, true);  // try Y-flipped
const groundUnflipped = sampleMap(tgas.ground_types, false);
const setG = [...new Set(groundFlipped)];
console.log(`ground_types distinct values: ${setG.length}, top 14: ${setG.slice(0,14).map(v=>'0x'+v.toString(16)).join(', ')}`);

// Detect: which side (flipped or not) has more F20-non-default cells AWAY from sea?
function landCount(coords, mapArr, seaValues) {
  let onLand = 0, onSea = 0;
  for (const c of coords) {
    const m = mapArr[c.i];
    if (seaValues.has(m)) onSea++; else onLand++;
  }
  return { onLand, onSea };
}

// Heuristic sea color: in ROME-remastered ground_types, sea is the deepest blue.
// Quick: find the largest contiguous color class and assume it's sea.
const groundHist = new Map();
for (const v of groundFlipped) groundHist.set(v, (groundHist.get(v) || 0) + 1);
const groundSorted = [...groundHist.entries()].sort((a,b)=>b[1]-a[1]);
console.log(`ground_types top 5 colors by frequency: ${groundSorted.slice(0,5).map(([v,c])=>`0x${v.toString(16)}×${c}`).join(', ')}`);
const seaColor = groundSorted[0][0];  // most common = sea
const seaSet = new Set([seaColor]);

for (const [fname, coords] of [['F20', f20nd], ['F28', f28nd], ['F32', f32nd]]) {
  console.log(`\n  ${fname} non-default (${coords.length} cells):`);
  for (const flipY of [false, true]) {
    const arr = flipY ? groundFlipped : groundUnflipped;
    const { onLand, onSea } = landCount(coords, arr, seaSet);
    console.log(`    ground_types ${flipY?'flipY':'normal'}: onLand=${onLand}, onSea=${onSea} (${(onLand/(onLand+onSea)*100).toFixed(1)}% land)`);
  }
}

// Strongest test: does field +28 = 54 form a vertical line at col 101 as
// session 35 claims? Map that col to map_features.tga and see what's there.
console.log('\n===== F28=54 line at col 101: features TGA values =====');
const f28_54 = [];
for (let i = 0; i < N_AVAIL; i++) if (fields.F28[i] === 54) f28_54.push(i);
console.log(`F28=54 cells: ${f28_54.length}; cols histogram:`);
const colHist = new Map();
for (const i of f28_54) {
  const c = i % W;
  colHist.set(c, (colHist.get(c) || 0) + 1);
}
const colTop = [...colHist.entries()].sort((a,b) => b[1] - a[1]).slice(0, 10);
console.log(`  top cols: ${colTop.map(([c,n])=>`col${c}×${n}`).join(', ')}`);

// For all F28=54 cells, dump their features-TGA color (both orientations)
const featuresMap = sampleMap(tgas.features, false);
const featuresMapFlip = sampleMap(tgas.features, true);
const fH = new Map(), fHflip = new Map();
for (const i of f28_54) {
  fH.set(featuresMap[i], (fH.get(featuresMap[i]) || 0) + 1);
  fHflip.set(featuresMapFlip[i], (fHflip.get(featuresMapFlip[i]) || 0) + 1);
}
console.log(`  features colors at F28=54 cells (normal): ${[...fH.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>`0x${v.toString(16)}×${c}`).join(', ')}`);
console.log(`  features colors at F28=54 cells (flipY):  ${[...fHflip.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>`0x${v.toString(16)}×${c}`).join(', ')}`);

// Also: which ground_types are at the F28=54 cells?
const gH = new Map(), gHflip = new Map();
for (const i of f28_54) {
  gH.set(groundUnflipped[i], (gH.get(groundUnflipped[i]) || 0) + 1);
  gHflip.set(groundFlipped[i], (gHflip.get(groundFlipped[i]) || 0) + 1);
}
console.log(`  ground_types at F28=54 cells (normal): ${[...gH.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>`0x${v.toString(16)}×${c}`).join(', ')}`);
console.log(`  ground_types at F28=54 cells (flipY):  ${[...gHflip.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([v,c])=>`0x${v.toString(16)}×${c}`).join(', ')}`);

// Same for F20=600 (385 cells) and F32=600 (516 cells)
console.log('\n===== F20=600 cells (385): map colors =====');
const f20_600 = [];
for (let i = 0; i < N_AVAIL; i++) if (fields.F20[i] === 600) f20_600.push(i);
for (const [mname, tga] of Object.entries(tgas)) {
  for (const flipY of [false, true]) {
    const arr = sampleMap(tga, flipY);
    const h = new Map();
    for (const i of f20_600) h.set(arr[i], (h.get(arr[i]) || 0) + 1);
    const top = [...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 5);
    console.log(`  ${mname.padEnd(13)} ${flipY?'flipY':'normal'}: ${top.map(([v,c])=>`0x${v.toString(16).padStart(6,'0')}×${c}`).join(', ')}`);
  }
}

console.log('\n===== F32=600 cells (516): map colors =====');
const f32_600 = [];
for (let i = 0; i < N_AVAIL; i++) if (fields.F32[i] === 600) f32_600.push(i);
for (const [mname, tga] of Object.entries(tgas)) {
  for (const flipY of [false, true]) {
    const arr = sampleMap(tga, flipY);
    const h = new Map();
    for (const i of f32_600) h.set(arr[i], (h.get(arr[i]) || 0) + 1);
    const top = [...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 5);
    console.log(`  ${mname.padEnd(13)} ${flipY?'flipY':'normal'}: ${top.map(([v,c])=>`0x${v.toString(16).padStart(6,'0')}×${c}`).join(', ')}`);
  }
}

// F32=-10 (93 cells) — "valley/depression"?
console.log('\n===== F32=-10 cells (93): map colors =====');
const f32_n10 = [];
for (let i = 0; i < N_AVAIL; i++) if (fields.F32[i] === -10) f32_n10.push(i);
for (const [mname, tga] of Object.entries(tgas)) {
  for (const flipY of [false, true]) {
    const arr = sampleMap(tga, flipY);
    const h = new Map();
    for (const i of f32_n10) h.set(arr[i], (h.get(arr[i]) || 0) + 1);
    const top = [...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 5);
    console.log(`  ${mname.padEnd(13)} ${flipY?'flipY':'normal'}: ${top.map(([v,c])=>`0x${v.toString(16).padStart(6,'0')}×${c}`).join(', ')}`);
  }
}

// F20=0 / F32=0 — could be "sea" markers?
console.log('\n===== F20=0 cells: map colors =====');
const f20_0 = [];
for (let i = 0; i < N_AVAIL; i++) if (fields.F20[i] === 0) f20_0.push(i);
console.log(`  count: ${f20_0.length}`);
for (const [mname, tga] of Object.entries(tgas)) {
  for (const flipY of [false, true]) {
    const arr = sampleMap(tga, flipY);
    const h = new Map();
    for (const i of f20_0) h.set(arr[i], (h.get(arr[i]) || 0) + 1);
    const top = [...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 5);
    console.log(`  ${mname.padEnd(13)} ${flipY?'flipY':'normal'}: ${top.map(([v,c])=>`0x${v.toString(16).padStart(6,'0')}×${c}`).join(', ')}`);
  }
}
