// Session 23: try other hypotheses for the 697 non-canonical interior mid-file cells.
// (a) AI mercenary pool locations - descr_mercenaries.txt has region-based mercenary pools.
//     Each major region has 1-3 pool centers. There are typically 50-80 such pools.
// (b) Rebel-spawn-script seed coords (6 from session 14)
// (c) Look at the variant key f16_f20_f24_f28_f32 distribution — maybe each variant maps to
//     a different entity type.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
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
      f0: buf.readUInt32LE(off),
      f4: buf.readUInt32LE(off + 4),
      f8: buf.readUInt32LE(off + 8),
      f12: buf.readUInt32LE(off + 12),
      f16: buf.readUInt32LE(off + 16),
      f20: buf.readUInt32LE(off + 20),
      f24: buf.readUInt32LE(off + 24),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
      f68: buf.readUInt32LE(off + 68),
      f84: buf.readUInt32LE(off + 84),
      f96: buf.readUInt32LE(off + 96),
    });
  }
}

const isCanonical = c => (c.f16 === 200 && c.f20 === 200 && c.f24 === 2 && c.f28 === 6 && c.f32 === 200);
const isInterior = c => (c.c !== 239 && c.r !== 237 && (c.c + c.r) !== 237);
const interior = cells.filter(isInterior);
const nonCan = interior.filter(c => !isCanonical(c));

console.log(`Total interior cells: ${interior.length}`);
console.log(`Non-canonical interior: ${nonCan.length}`);

// Variant histogram - show top 20
const variantHist = new Map();
for (const c of nonCan) {
  const k = `${c.f16}_${c.f20}_${c.f24}_${c.f28}_${c.f32}`;
  if (!variantHist.has(k)) variantHist.set(k, { count: 0, cells: [] });
  const v = variantHist.get(k);
  v.count++;
  v.cells.push(c);
}
console.log(`\n=== Variant histogram ===`);
const sorted = [...variantHist.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [k, v] of sorted.slice(0, 15)) console.log(`  ${k.padEnd(40)} count=${v.count}`);

// For each variant, compute centroid + spread - is it spatially clustered?
console.log(`\n=== Spatial clustering per variant (top 8) ===`);
for (const [k, v] of sorted.slice(0, 8)) {
  if (v.count < 5) break;
  let sumC = 0, sumR = 0;
  for (const c of v.cells) { sumC += c.c; sumR += c.r; }
  const cc = sumC / v.count, rr = sumR / v.count;
  let dist2 = 0;
  for (const c of v.cells) dist2 += (c.c - cc) ** 2 + (c.r - rr) ** 2;
  const stddev = Math.sqrt(dist2 / v.count);
  console.log(`  ${k.padEnd(40)} centroid=(${cc.toFixed(1)},${rr.toFixed(1)}) stddev=${stddev.toFixed(1)} count=${v.count}`);
}

// Most common variant cluster: what fields differ from canonical?
console.log(`\n=== Top variant cell field details ===`);
const top = sorted[0];
console.log(`Top variant '${top[0]}' (count=${top[1].count}):`);
for (const c of top[1].cells.slice(0, 5)) {
  console.log(`  (${c.c},${c.r}) f0=${c.f0} f4=${c.f4} f8=${c.f8} f12=${c.f12} f16=${c.f16} f20=${c.f20} f24=${c.f24} f28=${c.f28} f32=${c.f32} f68=${c.f68} f84=${c.f84} f96=${c.f96}`);
}

// Canonical for comparison
const canCell = interior.find(isCanonical);
console.log(`Canonical for comparison:`);
console.log(`  (${canCell.c},${canCell.r}) f0=${canCell.f0} f4=${canCell.f4} f8=${canCell.f8} f12=${canCell.f12} f16=${canCell.f16} f20=${canCell.f20} f24=${canCell.f24} f28=${canCell.f28} f32=${canCell.f32} f68=${canCell.f68} f84=${canCell.f84} f96=${canCell.f96}`);

// Map all non-canonical cells to (X,Y) tile coords using session 16's PX_W/PX_H scale
// and see if they form a recognizable pattern (river? coast? known road network?)
const PX_W = 1020, PX_H = 700;
const CELL_PX_W = PX_W / W, CELL_PX_H = PX_H / H;
console.log(`\n=== Spatial bounds of non-canonical cells ===`);
const cs = nonCan.map(c => c.c);
const rs = nonCan.map(c => c.r);
console.log(`  C range: ${Math.min(...cs)}..${Math.max(...cs)} (px ${Math.min(...cs)*CELL_PX_W|0}..${Math.max(...cs)*CELL_PX_W|0})`);
console.log(`  R range: ${Math.min(...rs)}..${Math.max(...rs)} (px ${Math.min(...rs)*CELL_PX_H|0}..${Math.max(...rs)*CELL_PX_H|0})`);

// Plot non-canonical cells as ASCII art on a small grid (60×24)
console.log(`\n=== ASCII map of non-canonical cells (60×30 downsampled) ===`);
const aw = 60, ah = 30;
const aspect = W / H;
const grid = Array.from({ length: ah }, () => Array(aw).fill('.'));
for (const c of nonCan) {
  const ax = Math.floor(c.c * aw / W);
  const ay = Math.floor(c.r * ah / H);
  if (ax >= 0 && ax < aw && ay >= 0 && ay < ah) grid[ay][ax] = '#';
}
for (const row of grid) console.log('  ' + row.join(''));

// Also: check if non-canonical cells form a Mediterranean-coastline shape
// The Mediterranean coast covers roughly the upper-half of the map. The bounds suggest
// most non-canon cells are in the populated zone, not random.
