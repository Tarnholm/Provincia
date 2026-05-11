// Session 22: the f20/f32 == 600 pattern is a clean DIAGONAL — this strongly
// suggests it's NOT terrain but rather something positional/index-based.
//
// Hypothesis: the array index might encode something other than (x,y) cell.
// Perhaps it's a *position-encoded* serial number and the diagonal is just
// "every 240+1 = 241st cell".
//
// Test 1: check the linear index relationship of f20==600 cells.
// Test 2: check if it's a trade route by overlaying map_trade_routes.tga.

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
      f20: buf.readUInt32LE(off + 20),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
    });
  }
}

// Find all cells where f32 == 600 — print their (c, r, idx, idx_diff_from_previous)
console.log('=== f32 == 600 cells (first 60) ===');
const f32_600 = cells.filter(c => c.c !== 239 && c.r !== 237 && c.f32 === 600);
console.log(`Total: ${f32_600.length}`);
let prev = -1;
for (let i = 0; i < Math.min(60, f32_600.length); i++) {
  const c = f32_600[i];
  const diff = prev >= 0 ? c.idx - prev : 0;
  console.log(`  [${i}] idx=${c.idx} c=${c.c} r=${c.r} diff=${diff}`);
  prev = c.idx;
}

// Histogram of idx-differences for f32==600
console.log('\n=== Histogram of idx differences for f32==600 ===');
const diffs = new Map();
prev = -1;
for (const c of f32_600) {
  if (prev >= 0) {
    const d = c.idx - prev;
    diffs.set(d, (diffs.get(d) || 0) + 1);
  }
  prev = c.idx;
}
const sortedDiffs = [...diffs.entries()].sort((a,b) => b[1]-a[1]);
for (const [d, n] of sortedDiffs.slice(0, 20)) console.log(`  diff=${d}: ${n}`);

// Check: a diagonal in 240-wide grid has neighbors at distance 240+1=241 or 240-1=239
// Same for f20==600
console.log('\n=== f20 == 600 cells diff histogram ===');
const f20_600 = cells.filter(c => c.c !== 239 && c.r !== 237 && c.f20 === 600);
console.log(`Total: ${f20_600.length}`);
const d20 = new Map();
prev = -1;
for (const c of f20_600) {
  if (prev >= 0) {
    const d = c.idx - prev;
    d20.set(d, (d20.get(d) || 0) + 1);
  }
  prev = c.idx;
}
const sd20 = [...d20.entries()].sort((a,b) => b[1]-a[1]);
for (const [d, n] of sd20.slice(0, 20)) console.log(`  diff=${d}: ${n}`);

// Now let me also check: looking at the visualization, the diagonal runs
// from (c~3, r~34) to (c~95, r~0) — that's a slope of about -3 col per 1 row
// going up and ~95/34 ≈ 2.8 col per row going right.
// Actually with W=240 c spans 0..95 mapped to gridW=100 means c = 0..230 actual.
// And rows in visualization are 0..34 mapped to H=238.
// So actual coords: diag from (c~0..10, r~234) to (c~225, r~0).
// In a 240x238 grid that's almost the full diagonal — slope ~1.

// Sample the trade routes map
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
  else if (imgType === 10 || imgType === 11) {
    pixelData = Buffer.alloc(w * h * channels);
    let src = dataStart, dst = 0;
    while (dst < pixelData.length) {
      const hdr = buf[src++]; const n = (hdr & 0x7f) + 1;
      if (hdr & 0x80) { const px = buf.subarray(src, src + channels); src += channels;
        for (let i = 0; i < n; i++) { px.copy(pixelData, dst); dst += channels; }
      } else {
        for (let i = 0; i < n; i++) { buf.copy(pixelData, dst, src, src + channels); src += channels; dst += channels; }
      }
    }
  }
  return { w, h, channels, pixelData, topDown,
    sample: (x, y) => {
      const ry = topDown ? y : (h - 1 - y);
      if (x < 0 || x >= w || ry < 0 || ry >= h) return null;
      const offset = (ry * w + x) * channels;
      if (channels === 1) return [pixelData[offset]];
      return [pixelData[offset+2], pixelData[offset+1], pixelData[offset]];
    }
  };
}

// Check trade routes
const tradeRoutes = loadTga('C:/RIS/RIS/data/world/maps/base/map_trade_routes.tga');
console.log(`\nTrade routes: ${tradeRoutes.w}x${tradeRoutes.h}`);
// Sample at some points
console.log('  px (500,350):', tradeRoutes.sample(500, 350));
console.log('  px (300,300):', tradeRoutes.sample(300, 300));

// Histogram of trade route pixel values at the f32==600 cells
console.log('\n=== Trade route pixel values at f32==600 cells ===');
const sxLog = 1020 / W, syLog = 700 / H;
const trHist = new Map();
for (const c of f32_600) {
  const x = Math.floor((c.c + 0.5) * sxLog);
  const y = Math.floor((c.r + 0.5) * syLog);
  const px = tradeRoutes.sample(x, y);
  if (!px) continue;
  const key = `${px[0]}_${px[1]}_${px[2]}`;
  trHist.set(key, (trHist.get(key) || 0) + 1);
}
for (const [k, n] of [...trHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10)) {
  console.log(`  ${k}: ${n}`);
}

// Compare to baseline (whole map)
console.log('\n=== Trade route pixel values, whole-map baseline (every 8th cell) ===');
const baseline = new Map();
for (let r = 0; r < H; r += 8) for (let c = 0; c < W; c += 8) {
  const x = Math.floor((c + 0.5) * sxLog);
  const y = Math.floor((r + 0.5) * syLog);
  const px = tradeRoutes.sample(x, y);
  if (!px) continue;
  const key = `${px[0]}_${px[1]}_${px[2]}`;
  baseline.set(key, (baseline.get(key) || 0) + 1);
}
for (const [k, n] of [...baseline.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10)) {
  console.log(`  ${k}: ${n}`);
}
