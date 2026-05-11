// Session 22: CONFIRM terrain enum mapping for the mid-file 240x238 grid.
//
// Hypothesis from session 21:
//   - f28=6  baseline (land)
//   - f28=55 mountain
//   - f28=54 sea/coast  (194 cells)
//   - f20=600 / f32=600 elevated terrain (256 / 479 cells)
//
// Method: for each of the 1,389 non-canonical mid-file records, compute the
// cell footprint in the 2041x1401 height/ground_types map and the 1020x700
// regions/features map, then aggregate:
//   - mean grayscale height (R channel, since R=G=B on land in map_heights)
//   - sea pixel count vs land pixel count (sea sentinel = RGB(0,0,253))
//   - region-id boundary crossings inside the cell footprint
//
// Cell footprint: each grid cell covers ~4.25x2.94 pixels of the 1020x700
// logical map, OR ~8.5x5.88 pixels of the 2041x1401 maps. We integrate
// across all pixels in the cell box (not just the center) for robustness.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240;
const H = 238;
const MAP_W = 1020;
const MAP_H = 700;

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
    let src = dataStart;
    let dst = 0;
    while (dst < pixelData.length) {
      const hdr = buf[src++];
      const n = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        const px = buf.subarray(src, src + channels);
        src += channels;
        for (let i = 0; i < n; i++) {
          px.copy(pixelData, dst);
          dst += channels;
        }
      } else {
        for (let i = 0; i < n; i++) {
          buf.copy(pixelData, dst, src, src + channels);
          src += channels;
          dst += channels;
        }
      }
    }
  } else {
    throw new Error(`Unsupported TGA type ${imgType}`);
  }
  function sample(x, y) {
    const ry = topDown ? y : (h - 1 - y);
    if (x < 0 || x >= w || ry < 0 || ry >= h) return null;
    const offset = (ry * w + x) * channels;
    if (channels === 1) return [pixelData[offset]];
    if (channels === 3) return [pixelData[offset+2], pixelData[offset+1], pixelData[offset]];
    if (channels === 4) return [pixelData[offset+2], pixelData[offset+1], pixelData[offset], pixelData[offset+3]];
  }
  console.log(`  loaded ${p.split(/[/\\]/).pop()} ${w}x${h} ${depth}bpp type=${imgType}`);
  return { w, h, channels, depth, sample };
}

console.log('Loading TGAs...');
const heights = loadTga('C:/RIS/RIS/data/world/maps/base/map_heights.tga');
const regions = loadTga('C:/RIS/RIS/data/world/maps/base/map_regions.tga');
const features = loadTga('C:/RIS/RIS/data/world/maps/base/map_features.tga');
const groundTypes = loadTga('C:/RIS/RIS/data/world/maps/base/map_ground_types.tga');

// Load save and decode all 240*238 cells
console.log('\nLoading save...');
const buf = fs.readFileSync(SAVE);
console.log(`  Save size: ${buf.length}`);

const cells = [];  // 240*238, indexed by r*W+c
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const off = ARR_START + (r * W + c) * STRIDE;
    cells.push({
      c, r,
      f20: buf.readUInt32LE(off + 20),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
    });
  }
}
console.log(`  ${cells.length} cells decoded`);

// For each cell, compute the footprint pixels:
//   - logical (1020x700) bbox: [(c+0)*4.25, (r+0)*2.941] to [(c+1)*4.25, (r+1)*2.941]
//   - heights (2041x1401) bbox: [(c+0)*8.504, (r+0)*5.886] to [(c+1)*8.504, (r+1)*5.886]
const sxLog = MAP_W / W;  // 4.25
const syLog = MAP_H / H;  // 2.94
const sxH = heights.w / W;  // ~8.50
const syH = heights.h / H;  // ~5.88

// Sample each cell across its full footprint.
function analyzeCell(c, r) {
  // Logical 1020x700 - sample regions/features
  const x0 = Math.floor(c * sxLog), x1 = Math.floor((c + 1) * sxLog);
  const y0 = Math.floor(r * syLog), y1 = Math.floor((r + 1) * syLog);
  let regionPixels = new Map();
  let featurePixels = new Map();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const rg = regions.sample(x, y);
      if (rg) {
        const key = `${rg[0]}_${rg[1]}_${rg[2]}`;
        regionPixels.set(key, (regionPixels.get(key) || 0) + 1);
      }
      const ft = features.sample(x, y);
      if (ft) {
        const key = `${ft[0]}_${ft[1]}_${ft[2]}`;
        featurePixels.set(key, (featurePixels.get(key) || 0) + 1);
      }
    }
  }

  // 2041x1401 - sample heights and ground types
  const hx0 = Math.floor(c * sxH), hx1 = Math.floor((c + 1) * sxH);
  const hy0 = Math.floor(r * syH), hy1 = Math.floor((r + 1) * syH);
  let heightSum = 0, heightMax = 0, heightMin = 255, heightN = 0;
  let seaCount = 0, landCount = 0;
  let groundTypes_ = new Map();
  for (let y = hy0; y < hy1; y++) {
    for (let x = hx0; x < hx1; x++) {
      const hg = heights.sample(x, y);
      if (hg) {
        // Sea sentinel = (0,0,253) — R=0, G=0, B=253
        if (hg[0] === 0 && hg[1] === 0 && hg[2] === 253) seaCount++;
        else {
          landCount++;
          heightSum += hg[0];
          if (hg[0] > heightMax) heightMax = hg[0];
          if (hg[0] < heightMin) heightMin = hg[0];
          heightN++;
        }
      }
      const gt = groundTypes.sample(x, y);
      if (gt) {
        const key = `${gt[0]}_${gt[1]}_${gt[2]}`;
        groundTypes_.set(key, (groundTypes_.get(key) || 0) + 1);
      }
    }
  }
  return {
    regionCount: regionPixels.size,
    featurePixels,
    seaCount, landCount,
    seaPct: (seaCount + landCount) > 0 ? seaCount / (seaCount + landCount) : 0,
    heightMean: heightN > 0 ? heightSum / heightN : 0,
    heightMax, heightMin,
    groundTypes: groundTypes_,
  };
}

// Aggregate per-variant statistics
const variantsByF28 = new Map();
const variantsByF20 = new Map();
const variantsByF32 = new Map();

console.log('\nAnalyzing cells (skipping edges col=239, row=237)...');
for (const cell of cells) {
  if (cell.c === 239 || cell.r === 237) continue;
  const a = analyzeCell(cell.c, cell.r);
  cell.analysis = a;

  for (const map of [
    { val: cell.f28, dst: variantsByF28 },
    { val: cell.f20, dst: variantsByF20 },
    { val: cell.f32, dst: variantsByF32 },
  ]) {
    if (!map.dst.has(map.val)) map.dst.set(map.val, {
      n: 0, seaPctSum: 0, heightSum: 0, heightN: 0,
      seaMajority: 0, // count of cells where seaPct >= 0.5
      regionBoundaries: 0,  // count of cells with >1 region
    });
    const v = map.dst.get(map.val);
    v.n++;
    v.seaPctSum += a.seaPct;
    if (a.seaPct >= 0.5) v.seaMajority++;
    if (a.heightMean > 0) {
      v.heightSum += a.heightMean;
      v.heightN++;
    }
    if (a.regionCount > 1) v.regionBoundaries++;
  }
}

function dump(label, map) {
  console.log(`\n=== ${label} ===`);
  const entries = [...map.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log(`  value | n     | seaPct_mean | seaMajority% | height_mean | regionBoundaryPct`);
  for (const [val, s] of entries) {
    const seaPct = s.seaPctSum / s.n;
    const seaMajPct = s.seaMajority / s.n;
    const heightMean = s.heightN > 0 ? s.heightSum / s.heightN : 0;
    const rbPct = s.regionBoundaries / s.n;
    console.log(`  ${String(val).padStart(10)} | ${String(s.n).padStart(5)} | ${seaPct.toFixed(3).padStart(11)} | ${(seaMajPct*100).toFixed(1).padStart(11)}% | ${heightMean.toFixed(2).padStart(11)} | ${(rbPct*100).toFixed(1).padStart(15)}%`);
  }
}
dump('f28', variantsByF28);
dump('f20', variantsByF20);
dump('f32', variantsByF32);
