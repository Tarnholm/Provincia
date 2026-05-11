// Decisive test: do f16/f20/f24/f28/f32 (the variant fields) encode the cell's
// height in some encoded form? If 200_600_2_6_600 corresponds to high-elevation
// cells, maybe the 600 value tracks the actual height.
//
// Alternative: maybe the variant fields are CELL-CLASSIFICATION codes:
//   - f24=200 / f28=6 = land, default
//   - f24=600 / f28=6 = hilly land
//   - f24=0 / f28=54 = mountains
//   - f24=0 / f28=55 = impassable mountains
//
// Test: per variant, sample 50 random cells; report their max-height range,
// roughness range, ground-type breakdown.

const fs = require('fs');
function loadTga(p) {
  const buf = fs.readFileSync(p);
  const idLen = buf[0];
  const imgType = buf[2];
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const depth = buf[16];
  const descriptor = buf[17];
  const topDown = (descriptor & 0x20) !== 0;
  const dataStart = 18 + idLen;
  const channels = depth / 8;
  let pixelData;
  if (imgType === 2 || imgType === 3) pixelData = buf.subarray(dataStart);
  else {
    pixelData = Buffer.alloc(w * h * channels);
    let src = dataStart, dst = 0;
    while (dst < pixelData.length) {
      const hdr = buf[src++]; const n = (hdr & 0x7f) + 1;
      if (hdr & 0x80) { const px = buf.subarray(src, src + channels); src += channels; for (let i = 0; i < n; i++) { px.copy(pixelData, dst); dst += channels; } }
      else for (let i = 0; i < n; i++) { buf.copy(pixelData, dst, src, src + channels); src += channels; dst += channels; }
    }
  }
  function sample(x, y) {
    const ry = topDown ? y : (h - 1 - y);
    if (x < 0 || x >= w || ry < 0 || ry >= h) return null;
    const offset = (ry * w + x) * channels;
    if (channels === 1) return [pixelData[offset]];
    return [pixelData[offset+2], pixelData[offset+1], pixelData[offset]];
  }
  return { w, h, sample };
}

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const ARR_START = 0xf8fd2, STRIDE = 267, W = 240, H = 238;
const buf = fs.readFileSync(SAVE);

const heights = loadTga('C:/RIS/RIS/data/world/maps/base/map_heights.tga');
const roughness = loadTga('C:/RIS/RIS/data/world/maps/base/map_roughness.tga');
const gtypes = loadTga('C:/RIS/RIS/data/world/maps/base/map_ground_types.tga');

function fullVariant(off) {
  return [
    buf.readUInt32LE(off + 16),
    buf.readUInt32LE(off + 20),
    buf.readUInt32LE(off + 24),
    buf.readUInt32LE(off + 28),
    buf.readUInt32LE(off + 32)
  ].join('_');
}

const hsx = heights.w / W, hsy = heights.h / H;
function maxH(c, r) {
  const x0 = Math.floor(c * hsx), x1 = Math.min(heights.w, Math.floor((c + 1) * hsx));
  const y0 = Math.floor(r * hsy), y1 = Math.min(heights.h, Math.floor((r + 1) * hsy));
  let m = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = heights.sample(xx, yy); if (p && p[0] > m) m = p[0]; }
  return m;
}
const rsx = roughness.w / W, rsy = roughness.h / H;
function avgRough(c, r) {
  const x0 = Math.floor(c * rsx), x1 = Math.min(roughness.w, Math.floor((c + 1) * rsx));
  const y0 = Math.floor(r * rsy), y1 = Math.min(roughness.h, Math.floor((r + 1) * rsy));
  let s = 0, n = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = roughness.sample(xx, yy); if (p) { s += p[0]; n++; } }
  return n > 0 ? s / n : 0;
}

// Per-variant aggregates
const variantStats = new Map();
for (let r = 0; r < H - 1; r++) {
  for (let c = 0; c < W - 1; c++) {
    const off = ARR_START + (r * W + c) * STRIDE;
    const v = fullVariant(off);
    if (!variantStats.has(v)) variantStats.set(v, { count: 0, hSum: 0, hMax: 0, hZeroCount: 0, rSum: 0, hVals: [] });
    const s = variantStats.get(v);
    const h = maxH(c, r);
    const rr = avgRough(c, r);
    s.count++;
    s.hSum += h;
    if (h === 0) s.hZeroCount++;
    if (h > s.hMax) s.hMax = h;
    s.rSum += rr;
    s.hVals.push(h);
  }
}

console.log(`\n=== Per-variant elevation/roughness summary ===`);
console.log(`variant                                       n   meanH  maxH  zero%  meanRough`);
const sorted = [...variantStats.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [v, s] of sorted) {
  const meanH = (s.hSum / s.count).toFixed(2);
  const zeroPct = (s.hZeroCount * 100 / s.count).toFixed(1);
  const meanR = (s.rSum / s.count).toFixed(1);
  console.log(`  ${v.padEnd(40)} ${s.count.toString().padStart(7)}  ${meanH.padStart(5)}  ${s.hMax.toString().padStart(3)}  ${zeroPct.padStart(5)}%  ${meanR}`);
}

// Save sorted list of cells with non-canon variants + their elevation
const out = sorted.filter(([v]) => v !== '200_200_2_6_200').map(([v, s]) => ({
  variant: v,
  count: s.count,
  meanH: s.hSum / s.count,
  meanRough: s.rSum / s.count,
  pctZeroH: s.hZeroCount * 100 / s.count
}));
fs.writeFileSync('C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells6-out.json', JSON.stringify(out, null, 2));
