// Session 22: visualize where non-canon cells fall on the map, and check if
// the grid orientation is correct. Session 21 assumed row r=0 is the top,
// but maybe it's flipped or transposed.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240;
const H = 238;

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

const heights = loadTga('C:/RIS/RIS/data/world/maps/base/map_heights.tga');
const regions = loadTga('C:/RIS/RIS/data/world/maps/base/map_regions.tga');

const buf = fs.readFileSync(SAVE);

const cells = [];
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

// Visualize a low-res 60x60 grid of f28 != 6 with both orientations
function visualize(label, predicate, flipY, transpose) {
  console.log(`\n--- ${label} (flipY=${flipY}, transpose=${transpose}) ---`);
  const bins = {};
  const Wp = transpose ? H : W;
  const Hp = transpose ? W : H;
  const gridW = 80, gridH = 30;
  const grid = [];
  for (let r = 0; r < gridH; r++) grid.push(new Array(gridW).fill('.'));
  for (const cell of cells) {
    if (cell.c === 239 || cell.r === 237) continue;
    if (!predicate(cell)) continue;
    let cc = cell.c, rr = cell.r;
    if (transpose) { const t = cc; cc = rr; rr = t; }
    if (flipY) rr = (Hp - 1) - rr;
    const gc = Math.floor(cc * gridW / Wp);
    const gr = Math.floor(rr * gridH / Hp);
    if (gr >= 0 && gr < gridH && gc >= 0 && gc < gridW) grid[gr][gc] = '#';
  }
  // Now overlay a coarse coastline by sampling regions
  const regSampler = (x, y) => {
    const px = regions.sample(x, y);
    if (!px) return false;
    return px[0] === 41 && px[1] === 140 && px[2] === 233;  // sea blue is (41,140,233)? Let's just check
  };
  // Print
  for (let r = 0; r < gridH; r++) console.log('  ' + grid[r].join(''));
}

// Need to know sea color. Sample a known sea pixel (e.g. middle of Mediterranean ~ (500, 350))
console.log('Sample at (500,350):', regions.sample(500, 350));
console.log('Sample at (300,500):', regions.sample(300, 500));
console.log('Sample at (700,400):', regions.sample(700, 400));

// Map_regions.tga: sea pixels are typically (41, 140, 233) blue OR (0,0,0) outside
// Let's also check the height-of-sea (R=0, G=0, B=253)
// First, find sea pixels in heights and overlay
function visualizeWithCoast(label, predicate) {
  console.log(`\n--- ${label} ---`);
  const gridW = 100, gridH = 35;
  const grid = [];
  for (let r = 0; r < gridH; r++) grid.push(new Array(gridW).fill(' '));

  // Background: coastline from heights
  for (let gr = 0; gr < gridH; gr++) {
    for (let gc = 0; gc < gridW; gc++) {
      // sample center of grid cell in 2041x1401 map
      const x = Math.floor((gc + 0.5) * heights.w / gridW);
      const y = Math.floor((gr + 0.5) * heights.h / gridH);
      const px = heights.sample(x, y);
      if (px) {
        if (px[0] === 0 && px[1] === 0 && px[2] === 253) grid[gr][gc] = '.';  // sea
        else if (px[0] > 50) grid[gr][gc] = ':';  // elevated land
        else grid[gr][gc] = '-';  // low land
      }
    }
  }

  // Foreground: matching cells
  for (const cell of cells) {
    if (cell.c === 239 || cell.r === 237) continue;
    if (!predicate(cell)) continue;
    const gc = Math.floor(cell.c * gridW / W);
    const gr = Math.floor(cell.r * gridH / H);
    if (gr >= 0 && gr < gridH && gc >= 0 && gc < gridW) grid[gr][gc] = '#';
  }
  for (let r = 0; r < gridH; r++) console.log('  ' + grid[r].join(''));
}

visualizeWithCoast('f28 == 54 (194 cells, "sea/coast" hypothesis)', c => c.f28 === 54);
visualizeWithCoast('f28 == 55 (16 cells, "mountain" hypothesis)', c => c.f28 === 55);
visualizeWithCoast('f20 == 600 (256 cells, "elevated" hypothesis)', c => c.f20 === 600);
visualizeWithCoast('f32 == 600 (479 cells, "elevated" hypothesis)', c => c.f32 === 600);
visualizeWithCoast('f32 == 0 (220 cells)', c => c.f32 === 0);
visualizeWithCoast('f20 == 0 (210 cells)', c => c.f20 === 0);
