// Load TGA files; sample per non-canonical cell; check correlation.

const fs = require('fs');

function loadTga(p) {
  const buf = fs.readFileSync(p);
  // TGA header: 18 bytes
  const idLen = buf[0];
  const imgType = buf[2];   // 2 = uncompressed RGB, 10 = RLE RGB, 3 = greyscale
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const depth = buf[16];    // bits/pixel
  const descriptor = buf[17];  // bit 5: 0 = bottom-up, 1 = top-down
  const topDown = (descriptor & 0x20) !== 0;
  const dataStart = 18 + idLen;
  const channels = depth / 8;
  console.log(`  TGA: ${p.split(/[/\\]/).pop()} ${w}x${h} ${depth}bpp type=${imgType} topDown=${topDown}`);
  // Sample function (X,Y in standard image coords with Y down)
  function sample(x, y) {
    const ry = topDown ? y : (h - 1 - y);
    if (x < 0 || x >= w || ry < 0 || ry >= h) return null;
    const offset = dataStart + (ry * w + x) * channels;
    if (channels === 1) return [buf[offset]];
    if (channels === 3) return [buf[offset+2], buf[offset+1], buf[offset]]; // BGR -> RGB
    if (channels === 4) return [buf[offset+2], buf[offset+1], buf[offset], buf[offset+3]];
  }
  return { w, h, channels, depth, sample };
}

const heights = loadTga('C:/RIS/RIS/data/world/maps/base/map_heights.tga');
const features = loadTga('C:/RIS/RIS/data/world/maps/base/map_features.tga');
const climates = loadTga('C:/RIS/RIS/data/world/maps/base/map_climates.tga');
const groundTypes = loadTga('C:/RIS/RIS/data/world/maps/base/map_ground_types.tga');

// Load mid-file cells
const data = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells1-out.json'));
const W = data.W, H = data.H;
const MAP_W = 1020;
const MAP_H = 700;

// Each cell (c, r) covers (c * 4.25 .. (c+1) * 4.25) horizontal, etc.
// Sample the CENTER pixel of each cell.
function cellToPixel(c, r) {
  const x = Math.floor((c + 0.5) * MAP_W / W);  // = (c + 0.5) * 4.25
  // The mid-file array may have Y inverted. Test both.
  // Y normal: y = (r+0.5)*700/238
  const y = Math.floor((r + 0.5) * MAP_H / H);
  return [x, y];
}

// Helper: build histogram of feature/climate/height values per variant.
function colorBin(rgb) { return rgb ? `${rgb[0]}_${rgb[1]}_${rgb[2]}` : 'null'; }
function heightBin(h) { return h ? Math.floor(h[0] / 16) * 16 : null; }  // 16-step bins

// First: print a sample of cells per variant with their pixel data
console.log(`\n--- Sampling 10 cells per variant ---`);
for (const v of data.variants) {
  console.log(`\nVariant ${v.variant} (${v.cells.length} cells):`);
  for (const cell of v.cells.slice(0, 5)) {
    const [x, y] = cellToPixel(cell.c, cell.r);
    const hRgb = heights.sample(x, y);
    const fRgb = features.sample(x, y);
    const cRgb = climates.sample(x, y);
    const gtRgb = groundTypes.sample(x, y);
    console.log(`  (${cell.c.toString().padStart(3)},${cell.r.toString().padStart(3)}) -> px(${x},${y})  height=${hRgb && hRgb[0]}  feature=${fRgb && colorBin(fRgb)}  climate=${cRgb && colorBin(cRgb)}  groundType=${gtRgb && colorBin(gtRgb)}`);
  }
}

// Compute baseline: random expected hit ratio for each color/value in each map.
// For each variant, build histogram and compute over-representation factor.
function computeStats(variants, sampler, binner) {
  // Baseline: sample one pixel per cell across the full 240x238 grid.
  const globalHist = new Map();
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const [x, y] = cellToPixel(c, r);
      const v = binner(sampler(x, y));
      globalHist.set(v, (globalHist.get(v) || 0) + 1);
    }
  }
  const total = W * H;
  const results = [];
  for (const variant of variants) {
    const hist = new Map();
    for (const cell of variant.cells) {
      const [x, y] = cellToPixel(cell.c, cell.r);
      const v = binner(sampler(x, y));
      hist.set(v, (hist.get(v) || 0) + 1);
    }
    // Compute over-representation:
    const ranked = [];
    for (const [v, n] of hist) {
      const expected = (globalHist.get(v) || 0) * variant.cells.length / total;
      const factor = expected > 0 ? n / expected : (n > 0 ? Infinity : 0);
      ranked.push({ v, n, expected, factor });
    }
    ranked.sort((a, b) => b.factor - a.factor);
    results.push({ variant: variant.variant, count: variant.cells.length, top: ranked.slice(0, 3) });
  }
  return results;
}

console.log(`\n--- Heights (16-bin) correlation per variant ---`);
const hStats = computeStats(data.variants, (x, y) => heights.sample(x, y), heightBin);
for (const r of hStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}

console.log(`\n--- Features correlation per variant ---`);
const fStats = computeStats(data.variants, (x, y) => features.sample(x, y), colorBin);
for (const r of fStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}

console.log(`\n--- Climates correlation per variant ---`);
const cStats = computeStats(data.variants, (x, y) => climates.sample(x, y), colorBin);
for (const r of cStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}

console.log(`\n--- GroundTypes correlation per variant ---`);
const gStats = computeStats(data.variants, (x, y) => groundTypes.sample(x, y), colorBin);
for (const r of gStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}
