// dig-midfile-aizone1.js — Test AI-strategic-zone hypothesis for the 697 non-canonical mid-file cells.
// Cross-reference against:
//   (a) distance to coastline (use map_regions.tga or map_heights.tga sea pixel)
//   (b) distance to nearest settlement (model-block coords)
//   (c) distance to region border
//   (d) path-finding move-cost grid (variant enum → terrain class)

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";

const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240;
const H = 238;

const buf = fs.readFileSync(SAVE);

const cells = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const idx = r * W + c;
    const off = ARR_START + idx * STRIDE;
    cells.push({
      idx, c, r,
      f16: buf.readUInt32LE(off + 16),
      f20: buf.readUInt32LE(off + 20),
      f24: buf.readUInt32LE(off + 24),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
    });
  }
}

const isCanonical = c => (c.f16 === 200 && c.f20 === 200 && c.f24 === 2 && c.f28 === 6 && c.f32 === 200);
const isInterior = c => (c.c !== 239 && c.r !== 237 && (c.c + c.r) !== 237);
const interior = cells.filter(isInterior);
const nonCan = interior.filter(c => !isCanonical(c));
const canon = interior.filter(isCanonical);
console.log(`Interior cells: ${interior.length}`);
console.log(`Non-canonical: ${nonCan.length}, canonical: ${canon.length}`);

// Variants
const variants = new Map();
for (const c of nonCan) {
  const k = `${c.f16}_${c.f20}_${c.f24}_${c.f28}_${c.f32}`;
  if (!variants.has(k)) variants.set(k, []);
  variants.get(k).push(c);
}

// Load settlement coords for nearest-settlement test
function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }
const knownModels = new Set(["W_hellenistic_Large_Town","W_hellenistic_Large_City","Celtic_Large_Town","W_hellenistic_City","Eastern_Large_Town","Illyrian_Large_Town","W_hellenistic_Town","Celtic_City","W_hellenistic_Huge_City","Carthaginian_Huge_City","Carthaginian_Large_Town","Eastern_City","Germanic_Large_Town","Nomad_Large_Town","Eastern_Town","Eastern_Huge_City","Carthaginian_City","Egyptian_Large_Town","Celtic_Town","Carthaginian_Town","Egyptian_Town","Illyrian_Town","Germanic_Town","Nomad_Town"]);
const settCoords = [];
const settSet = new Set();
for (let p = 0x1f43000; p + 2 < 0x1f95000; p++) {
  const lp1 = buf.readUInt16LE(p);
  if (lp1 < 9 || lp1 > 30) continue;
  if (p + 2 + lp1 > 0x1f95000) continue;
  const sl = lp1 - 1;
  let ok = true;
  for (let i = 0; i < sl; i++) if (!isModelChar(buf[p + 2 + i])) { ok = false; break; }
  if (!ok) continue;
  if (buf[p + 2 + sl] !== 0) continue;
  const nm = buf.slice(p + 2, p + 2 + sl).toString("ascii");
  if (!knownModels.has(nm)) continue;
  const postName = p + 2 + lp1;
  const tag = buf.readUInt32LE(postName);
  if (tag !== 27 && tag !== 29 && tag !== 31) { p = postName - 1; continue; }
  const x = buf.readUInt32LE(postName + 4);
  const y = buf.readUInt32LE(postName + 8);
  const k = `${x},${y}`;
  if (!settSet.has(k)) {
    settSet.add(k);
    settCoords.push({ x, y });
  }
  p = postName - 1;
}
console.log(`Distinct settlement coords: ${settCoords.length}`);

// Convert cell (c, r) → pixel (x, y) on 1020×700 map
// per session 16, scale ~ 4.25 × 2.94 px/cell
const PX_W = 1020, PX_H = 700;
const CELL_PX_W = PX_W / W; // 4.25
const CELL_PX_H = PX_H / H; // 2.94

function cellToPx(c) {
  return {
    x: c.c * CELL_PX_W + CELL_PX_W / 2,
    y: c.r * CELL_PX_H + CELL_PX_H / 2,
  };
}

// Test 1: Each variant's mean distance to nearest settlement
function nearestSettDist(cell) {
  const p = cellToPx(cell);
  let best = Infinity;
  for (const s of settCoords) {
    const d = Math.sqrt((p.x - s.x) ** 2 + (p.y - s.y) ** 2);
    if (d < best) best = d;
  }
  return best;
}

console.log(`\n--- Variant mean distance to nearest settlement ---`);
const variantStats = [];
for (const [k, cs] of variants) {
  if (cs.length < 5) continue;
  const dists = cs.map(nearestSettDist);
  const mean = dists.reduce((s, d) => s + d, 0) / dists.length;
  const sortedD = [...dists].sort((a, b) => a - b);
  const median = sortedD[Math.floor(sortedD.length / 2)];
  // Centroid
  const cc = cs.reduce((s, c) => s + c.c, 0) / cs.length;
  const rr = cs.reduce((s, c) => s + c.r, 0) / cs.length;
  variantStats.push({ k, n: cs.length, mean, median, cc, rr });
}
variantStats.sort((a, b) => b.n - a.n);
for (const v of variantStats) {
  console.log(`  ${v.k.padEnd(40)} n=${v.n.toString().padStart(3)} meanD=${v.mean.toFixed(1).padStart(7)} medD=${v.median.toFixed(1).padStart(7)} centroid=(${v.cc.toFixed(0)},${v.rr.toFixed(0)})`);
}

// Baseline: random canonical sample
const sample = [];
for (let i = 0; i < 200; i++) sample.push(canon[Math.floor(Math.random() * canon.length)]);
const sampleDists = sample.map(nearestSettDist);
const sampleMean = sampleDists.reduce((s, d) => s + d, 0) / sampleDists.length;
console.log(`\nBaseline (200 random canonical cells): meanD=${sampleMean.toFixed(2)}`);

// Test 2: Each variant's spatial density — do variant cells form contiguous regions?
// For each variant, check 8-neighbour same-variant count
console.log(`\n--- Variant spatial connectedness (8-neighbour same-variant fraction) ---`);
const cellByIdx = new Map();
for (const c of interior) cellByIdx.set(c.idx, c);

function neighborMatch(cs, k) {
  const set = new Set(cs.map(c => c.idx));
  let matches = 0, total = 0;
  for (const c of cs) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nIdx = (c.r + dr) * W + (c.c + dc);
        if (set.has(nIdx)) matches++;
        total++;
      }
    }
  }
  return total === 0 ? 0 : matches / total;
}
for (const [k, cs] of [...variants.entries()].sort((a,b) => b[1].length - a[1].length)) {
  if (cs.length < 5) continue;
  const frac = neighborMatch(cs, k);
  console.log(`  ${k.padEnd(40)} n=${cs.length.toString().padStart(3)} 8-nbr same-variant fraction=${(frac*100).toFixed(1)}%`);
}

// Test 3: Tabulate variant counts vs distance bands from coast (use map_regions for sea pixels)
// Need map_regions for that. Skip if unavailable.
const REGIONS_TGA = "C:/RIS/RIS/data/world/maps/base/map_regions.tga";
let regionsBuf = null;
try {
  regionsBuf = fs.readFileSync(REGIONS_TGA);
} catch (e) { console.log("map_regions.tga not available; skipping coastline test"); }

if (regionsBuf) {
  // TGA: 18-byte header, then pixels (24bpp BGR, bottom-to-top)
  // Width: readUInt16LE at +12
  const tgaW = regionsBuf.readUInt16LE(12);
  const tgaH = regionsBuf.readUInt16LE(14);
  const bpp = regionsBuf[16];
  console.log(`\nmap_regions.tga: ${tgaW}×${tgaH} ${bpp}bpp`);
  // For each pixel: is it sea (RGB(41,140,233) approx for RTW map_regions)?
  // Actually for ROME RTW the sea sentinel may differ. Just check: which pixel color dominates?
  const colorCount = new Map();
  const headerSize = 18;
  // sample 1000 pixels
  for (let i = 0; i < 1000; i++) {
    const off = headerSize + Math.floor(Math.random() * tgaW * tgaH) * 3;
    const b = regionsBuf[off], g = regionsBuf[off + 1], r = regionsBuf[off + 2];
    const k = `${r},${g},${b}`;
    colorCount.set(k, (colorCount.get(k) || 0) + 1);
  }
  console.log(`Top colors in 1000 random samples:`);
  for (const [k, c] of [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`  RGB(${k}): ${c}`);
  }
  // Sea color is likely the top one
  // Use pixel(x, y): TGA stores bottom-to-top. Pixel at (x, y) on display = TGA row (H-1-y)
  function getPx(x, y) {
    const tgaRow = tgaH - 1 - y;
    const off = headerSize + (tgaRow * tgaW + x) * 3;
    return { b: regionsBuf[off], g: regionsBuf[off + 1], r: regionsBuf[off + 2] };
  }
  // Determine sea by inspecting a corner pixel
  const corner = getPx(5, 5);
  console.log(`Corner pixel (5,5): RGB(${corner.r},${corner.g},${corner.b})`);
  // Try (0,0)
  const c00 = getPx(0, 0);
  console.log(`Pixel (0,0): RGB(${c00.r},${c00.g},${c00.b})`);
  // Search for sea color: a color present mostly at edges. Use frequency from sampling.
  const top = [...colorCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const [sR, sG, sB] = top[0].split(",").map(Number);
  console.log(`Assumed sea color: RGB(${sR},${sG},${sB})`);

  function isSea(x, y) {
    if (x < 0 || x >= tgaW || y < 0 || y >= tgaH) return true;
    const p = getPx(x, y);
    return p.r === sR && p.g === sG && p.b === sB;
  }

  // For each cell, compute "is the centre pixel sea?" and "min distance to coastline"
  // The cell footprint maps to map area. With 240×238 cells and 1020×700 px, scale 4.25×2.94.
  // map_regions is 2041×1401 (per session 22), so scale is different — let's just use 1020×700 base
  // by sampling cell pixels at TGA coords scaled.
  // Actually map_regions.tga is given as 1020×700 in session 22... but heights is 2041×1401.
  // Wait — session 22 said "map_regions.tga (1020×700, 24bpp BGR)". So tgaW should be 1020.
  console.log(`Actual TGA dims: ${tgaW}×${tgaH}`);

  // For each variant: % of cells with center on sea, mean distance to nearest sea pixel
  const seaSampleK = 100;
  function pctSea(cells) {
    let nSea = 0;
    for (const cell of cells) {
      const p = cellToPx(cell);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (isSea(x, y)) nSea++;
    }
    return nSea / cells.length;
  }

  console.log(`\n--- Variant: % cells on sea pixel ---`);
  console.log(`  Canonical baseline (sample 200): ${(pctSea(sample) * 100).toFixed(1)}%`);
  for (const [k, cs] of [...variants.entries()].sort((a,b) => b[1].length - a[1].length)) {
    if (cs.length < 5) continue;
    console.log(`  ${k.padEnd(40)} n=${cs.length.toString().padStart(3)} %sea=${(pctSea(cs) * 100).toFixed(1)}%`);
  }
}
