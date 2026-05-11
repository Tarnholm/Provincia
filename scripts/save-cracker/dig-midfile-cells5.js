// Test: are non-canonical cells correlated with region boundaries
// (i.e., cells where the map_regions.tga value differs from its neighbors)?

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
        const px = buf.subarray(src, src + channels); src += channels;
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
  return { w, h, sample, pixelData, channels };
}

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240, H = 238;
const buf = fs.readFileSync(SAVE);

const regions = loadTga('C:/RIS/RIS/data/world/maps/base/map_regions.tga');
console.log(`map_regions: ${regions.w}x${regions.h}`);

function variant(off) {
  return `${buf.readUInt32LE(off+16)}_${buf.readUInt32LE(off+20)}_${buf.readUInt32LE(off+24)}_${buf.readUInt32LE(off+28)}_${buf.readUInt32LE(off+32)}`;
}

// For each cell, look at the dominant region-color in the cell area, and
// count how many DIFFERENT region-colors appear within (= cell crosses boundaries).
const sx = regions.w / W;
const sy = regions.h / H;
function cellRegionCount(c, r) {
  const x0 = Math.floor(c * sx);
  const x1 = Math.min(regions.w, Math.floor((c + 1) * sx));
  const y0 = Math.floor(r * sy);
  const y1 = Math.min(regions.h, Math.floor((r + 1) * sy));
  const colors = new Set();
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const p = regions.sample(xx, yy);
      if (p) colors.add(`${p[0]}_${p[1]}_${p[2]}`);
    }
  }
  return colors.size;
}

// Categorize by region-count
const buckets = [1, 2, 3, 4, 5, 6, 10];
const stats = buckets.map(b => ({ min: b, canon: 0, nonCanon: 0, variants: new Map() }));

let totalNonCanon = 0;
for (let r = 0; r < H - 1; r++) {
  for (let c = 0; c < W - 1; c++) {
    const off = ARR_START + (r * W + c) * STRIDE;
    const v = variant(off);
    const cnt = cellRegionCount(c, r);
    let bi = 0;
    for (let k = buckets.length - 1; k >= 0; k--) if (cnt >= buckets[k]) { bi = k; break; }
    const s = stats[bi];
    if (v === '200_200_2_6_200') s.canon++;
    else {
      s.nonCanon++;
      totalNonCanon++;
      s.variants.set(v, (s.variants.get(v) || 0) + 1);
    }
  }
}
console.log(`Total non-canon (excluding edges): ${totalNonCanon}`);
console.log(`\n=== Region-boundary count vs Canon ratio ===`);
console.log(`regionsTouched  canon    nonCanon    nonCanon%   topVariants`);
for (let i = 0; i < stats.length; i++) {
  const s = stats[i];
  const tot = s.canon + s.nonCanon;
  if (tot === 0) continue;
  const pct = (s.nonCanon * 100 / tot).toFixed(2);
  const topV = [...s.variants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  >=${buckets[i]}  ${s.canon.toString().padStart(6)}   ${s.nonCanon.toString().padStart(5)}    ${pct}%   ${topV.map(([v, n]) => `${v}:${n}`).join('  ')}`);
}

// Also check if non-canonical cells are concentrated in SEA cells (those whose
// dominant region color is pure black, which is the sea color in map_regions.tga)
const seaCells = { canon: 0, nonCanon: 0 };
const landCells = { canon: 0, nonCanon: 0 };
function isSeaCell(c, r) {
  const x0 = Math.floor(c * sx), x1 = Math.min(regions.w, Math.floor((c + 1) * sx));
  const y0 = Math.floor(r * sy), y1 = Math.min(regions.h, Math.floor((r + 1) * sy));
  let blackCount = 0, total = 0;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const p = regions.sample(xx, yy);
      total++;
      if (p && p[0] === 41 && p[1] === 140 && p[2] === 233) blackCount++; // sea blueish
      if (p && p[0] === 0 && p[1] === 0 && p[2] === 0) blackCount++; // alt sea black
    }
  }
  return blackCount > total * 0.5;
}
for (let r = 0; r < H - 1; r++) {
  for (let c = 0; c < W - 1; c++) {
    const off = ARR_START + (r * W + c) * STRIDE;
    const v = variant(off);
    const isSea = isSeaCell(c, r);
    const bucket = isSea ? seaCells : landCells;
    if (v === '200_200_2_6_200') bucket.canon++; else bucket.nonCanon++;
  }
}
console.log(`\n=== Sea vs Land non-canon distribution ===`);
console.log(`  Sea cells:  canon=${seaCells.canon}  nonCanon=${seaCells.nonCanon}  (nonCanon%=${(seaCells.nonCanon*100/(seaCells.canon+seaCells.nonCanon)).toFixed(2)}%)`);
console.log(`  Land cells: canon=${landCells.canon}  nonCanon=${landCells.nonCanon}  (nonCanon%=${(landCells.nonCanon*100/(landCells.canon+landCells.nonCanon)).toFixed(2)}%)`);
