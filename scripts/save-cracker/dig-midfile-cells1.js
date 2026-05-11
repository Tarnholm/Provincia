// Session 21: Mid-file 1,389 non-canonical cells decoder.
//
// Test forest, mountains, height-extreme, climate-edge, roughness hypotheses.
// Strategy:
//   1. Load rome10 save's mid-file array at 0xf8fd2 (57,120 records × 267 bytes).
//   2. Identify each non-canonical record and which (col, row) in 240×238 grid.
//   3. Compute the corresponding pixel (X,Y) in the 1020×700 source maps.
//   4. Sample map_heights.tga, map_features.tga, map_climates.tga,
//      map_roughness.tga at that pixel.
//   5. Compute correlation with each non-canonical variant.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240;
const H = 238;
const RECORDS = W * H;
const MAP_W = 1020;
const MAP_H = 700;

const buf = fs.readFileSync(SAVE);
console.log(`Save size: ${buf.length}`);
console.log(`Array start: 0x${ARR_START.toString(16)}; expected end: 0x${(ARR_START + RECORDS * STRIDE).toString(16)}`);

// Decode each record's "variant key" (multi-field combination).
function variantKey(rec) {
  return `${rec.f0}_${rec.f12}_${rec.f24}_${rec.f28}_${rec.f32}`;
}
function decodeRecord(off) {
  // From session 18: canonical = 5_10_2_6_200 etc. But we encode as f0, f12, f16, f20, f24, f28, f32.
  // Session 18 noted variant fields at offsets 0, 12, 16, 20, 24, 28, 32, 84, 96.
  // The "key" was (200, 200, 2, 6, 200) which maps to (+16, +20, +24, +28, +32) per session 18 notes.
  // Let me check by reading those.
  return {
    f0:  buf.readUInt32LE(off),
    f12: buf.readUInt32LE(off + 12),
    f16: buf.readUInt32LE(off + 16),
    f20: buf.readUInt32LE(off + 20),
    f24: buf.readUInt32LE(off + 24),
    f28: buf.readUInt32LE(off + 28),
    f32: buf.readUInt32LE(off + 32),
    f84: buf.readUInt32LE(off + 84),
    f96: buf.readUInt32LE(off + 96)
  };
}

// Quick canonical check: from session 18, canonical key = "200_200_2_6_200"
// Variant key from session 18 = (f16, f20, f24, f28, f32)
function variant(rec) { return `${rec.f16}_${rec.f20}_${rec.f24}_${rec.f28}_${rec.f32}`; }

const nonCanonByVariant = new Map();
const variantByCell = new Map();
let canon = 0, nonCanon = 0;
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const idx = r * W + c;
    const off = ARR_START + idx * STRIDE;
    const rec = decodeRecord(off);
    const v = variant(rec);
    if (v === '200_200_2_6_200') {
      canon++;
    } else {
      nonCanon++;
      if (!nonCanonByVariant.has(v)) nonCanonByVariant.set(v, []);
      nonCanonByVariant.get(v).push({ c, r, idx, rec });
      variantByCell.set(`${c},${r}`, v);
    }
  }
}
console.log(`\nCanon: ${canon}, NonCanon: ${nonCanon} (total ${canon + nonCanon})`);
console.log(`\nNonCanon variant histogram:`);
const variants = [...nonCanonByVariant.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [v, cells] of variants) {
  console.log(`  ${v.padEnd(40)} ${cells.length}`);
}

// Exclude the edge markers (col=239, row=237) — those are uniform edge data.
// Get truly interesting cells (interior non-canonical).
const interior = nonCanon === 1389 ? [] : null;
let interiorNonCanon = 0;
const interiorByVariant = new Map();
for (const [v, cells] of nonCanonByVariant) {
  for (const cell of cells) {
    if (cell.c === 239 || cell.r === 237) continue;  // edge markers
    interiorNonCanon++;
    if (!interiorByVariant.has(v)) interiorByVariant.set(v, []);
    interiorByVariant.get(v).push(cell);
  }
}
console.log(`\nInterior non-canon (excluding edge markers): ${interiorNonCanon}`);
console.log(`Interior variant histogram:`);
const ivar = [...interiorByVariant.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [v, cells] of ivar) {
  console.log(`  ${v.padEnd(40)} ${cells.length}`);
}

// Save the cells list to JSON for next step
const out = {
  ARR_START, STRIDE, W, H,
  variants: ivar.map(([v, cells]) => ({
    variant: v,
    cells: cells.map(c => ({ c: c.c, r: c.r }))
  }))
};
fs.writeFileSync('C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells1-out.json', JSON.stringify(out, null, 2));
console.log(`\nWrote ${out.variants.length} interior variants to dig-midfile-cells1-out.json`);
