// Print the actual cells with f28=55. Map them to pixel coords in map_regions
// to identify which regions they fall in. If those are known mountainous regions
// (Alps, Pyrenees, Atlas, Caucasus, etc.), it confirms the hypothesis.

const fs = require('fs');
function loadTga(p) {
  const buf = fs.readFileSync(p);
  const idLen = buf[0]; const imgType = buf[2];
  const w = buf.readUInt16LE(12); const h = buf.readUInt16LE(14);
  const depth = buf[16]; const descriptor = buf[17];
  const topDown = (descriptor & 0x20) !== 0;
  const dataStart = 18 + idLen; const channels = depth / 8;
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

// Pixel coord of cell center
function cellPixel(c, r) {
  // Use 1020x700 logical coords
  return [Math.floor((c + 0.5) * 1020 / W), Math.floor((r + 0.5) * 700 / H)];
}
const hsx = heights.w / W, hsy = heights.h / H;
function maxH(c, r) {
  const x0 = Math.floor(c * hsx), x1 = Math.min(heights.w, Math.floor((c + 1) * hsx));
  const y0 = Math.floor(r * hsy), y1 = Math.min(heights.h, Math.floor((r + 1) * hsy));
  let m = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = heights.sample(xx, yy); if (p && p[0] > m) m = p[0]; }
  return m;
}

// Print cells per field value
const groups = new Map();
for (let r = 0; r < H - 1; r++) {
  for (let c = 0; c < W - 1; c++) {
    const off = ARR_START + (r * W + c) * STRIDE;
    const f20 = buf.readUInt32LE(off + 20);
    const f28 = buf.readUInt32LE(off + 28);
    const f32 = buf.readInt32LE(off + 32);
    const key = `f20=${f20}_f28=${f28}_f32=${f32}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ c, r });
  }
}

// Show cells where f28 == 55 or f20 == 600 — the elevated-categories
const interesting = [];
for (const [key, cells] of groups) {
  if (key.includes('f28=55') || key.includes('f20=600') || key.includes('f20=0_f28=54')) {
    interesting.push([key, cells]);
  }
}
interesting.sort((a, b) => b[1].length - a[1].length);
for (const [key, cells] of interesting) {
  console.log(`\n=== ${key} : ${cells.length} cells ===`);
  // Center of the cluster
  const cs = cells.map(c => c.c);
  const rs = cells.map(c => c.r);
  const meanC = cs.reduce((s,x)=>s+x,0)/cs.length;
  const meanR = rs.reduce((s,x)=>s+x,0)/rs.length;
  const centerPx = cellPixel(meanC, meanR);
  console.log(`  Cluster center: cell(${meanC.toFixed(1)}, ${meanR.toFixed(1)}) -> pixel(${centerPx[0]}, ${centerPx[1]}) on 1020x700 logical map`);
  // Print individual cells with their pixel coords + heights
  for (const cell of cells.slice(0, 20)) {
    const [px, py] = cellPixel(cell.c, cell.r);
    const h = maxH(cell.c, cell.r);
    console.log(`    cell(${cell.c.toString().padStart(3)},${cell.r.toString().padStart(3)}) -> px(${px},${py}) maxH=${h}`);
  }
  if (cells.length > 20) console.log(`    ... and ${cells.length - 20} more`);
}
