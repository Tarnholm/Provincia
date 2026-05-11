// Rigorous test: bin EVERY mid-file cell by its source-map height, and show
// how non-canonical rate varies with height. If the mid-file array encodes
// elevation-derived strategic data, we'd expect a clean correlation.

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
  if (imgType === 2 || imgType === 3) {
    pixelData = buf.subarray(dataStart);
  } else if (imgType === 10 || imgType === 11) {
    pixelData = Buffer.alloc(w * h * channels);
    let src = dataStart, dst = 0;
    while (dst < pixelData.length) {
      const hdr = buf[src++];
      const n = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        const px = buf.subarray(src, src + channels);
        src += channels;
        for (let i = 0; i < n; i++) { px.copy(pixelData, dst); dst += channels; }
      } else {
        for (let i = 0; i < n; i++) { buf.copy(pixelData, dst, src, src + channels); src += channels; dst += channels; }
      }
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
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;
const buf = fs.readFileSync(SAVE);

const heights = loadTga('C:/RIS/RIS/data/world/maps/base/map_heights.tga');
const gtypes = loadTga('C:/RIS/RIS/data/world/maps/base/map_ground_types.tga');

function variant(off) {
  return `${buf.readUInt32LE(off+16)}_${buf.readUInt32LE(off+20)}_${buf.readUInt32LE(off+24)}_${buf.readUInt32LE(off+28)}_${buf.readUInt32LE(off+32)}`;
}

// For each cell, compute MAX height in the 8.5x5.9 pixel block (full coverage,
// not just center sample). Then bin by height level.
const hSx = heights.w / W;
const hSy = heights.h / H;
function cellMaxHeight(c, r) {
  const x0 = Math.floor(c * hSx);
  const x1 = Math.min(heights.w, Math.floor((c + 1) * hSx));
  const y0 = Math.floor(r * hSy);
  const y1 = Math.min(heights.h, Math.floor((r + 1) * hSy));
  let max = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const h = heights.sample(xx, yy);
      if (h && h[0] > max) max = h[0];
    }
  }
  return max;
}

// Categorize cells: bin by elevation, count canon vs non-canon
const elevBins = [0, 1, 8, 16, 32, 64, 128, 256];
const stats = elevBins.map(b => ({ low: b, canon: 0, nonCanon: 0, variants: new Map() }));
function binIdx(h) {
  for (let i = elevBins.length - 1; i >= 0; i--) if (h >= elevBins[i]) return i;
  return 0;
}

for (let r = 0; r < H - 1; r++) {  // exclude bottom row (edge marker)
  for (let c = 0; c < W - 1; c++) { // exclude rightmost col
    const off = ARR_START + (r * W + c) * STRIDE;
    const v = variant(off);
    const h = cellMaxHeight(c, r);
    const bin = stats[binIdx(h)];
    if (v === '200_200_2_6_200') bin.canon++;
    else {
      bin.nonCanon++;
      bin.variants.set(v, (bin.variants.get(v) || 0) + 1);
    }
  }
}

console.log(`\n=== Elevation vs Canon/Non-Canon ratio ===`);
console.log(`height-min  canon   nonCanon   nonCanon%  top-3-variants`);
for (let i = 0; i < stats.length; i++) {
  const s = stats[i];
  const tot = s.canon + s.nonCanon;
  if (tot === 0) continue;
  const pct = (s.nonCanon * 100 / tot).toFixed(2);
  const topV = [...s.variants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  >=${elevBins[i].toString().padStart(4)}   ${s.canon.toString().padStart(5)}   ${s.nonCanon.toString().padStart(5)}    ${pct}%   ${topV.map(([v, n]) => `${v}:${n}`).join('  ')}`);
}

// Now: for the variant with highest height-correlation (200_600_2_6_600),
// show how its cells distribute across elevation:
console.log(`\n=== Top variants by elevation distribution ===`);
const variantElev = new Map();
for (let r = 0; r < H - 1; r++) {
  for (let c = 0; c < W - 1; c++) {
    const off = ARR_START + (r * W + c) * STRIDE;
    const v = variant(off);
    if (!variantElev.has(v)) variantElev.set(v, []);
    variantElev.get(v).push(cellMaxHeight(c, r));
  }
}
for (const [v, hs] of variantElev) {
  if (hs.length < 10) continue;
  hs.sort((a, b) => a - b);
  const med = hs[Math.floor(hs.length / 2)];
  const mean = hs.reduce((s, x) => s + x, 0) / hs.length;
  const max = hs[hs.length - 1];
  const nonZero = hs.filter(h => h > 0).length;
  console.log(`  ${v.padEnd(40)} n=${hs.length}  mean=${mean.toFixed(1)} median=${med} max=${max} non-zero%=${(nonZero*100/hs.length).toFixed(0)}%`);
}
