// Group cells by their f28 (offset +28) field value, ignoring all other fields.
// Look at elevation/groundtype distribution per f28 value to test the
// "+28 = terrain-classification enum" hypothesis.

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

const hsx = heights.w / W, hsy = heights.h / H;
function maxH(c, r) {
  const x0 = Math.floor(c * hsx), x1 = Math.min(heights.w, Math.floor((c + 1) * hsx));
  const y0 = Math.floor(r * hsy), y1 = Math.min(heights.h, Math.floor((r + 1) * hsy));
  let m = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const p = heights.sample(xx, yy); if (p && p[0] > m) m = p[0]; }
  return m;
}

// Per-field analysis: group by (f16, f20, f24, f28, f32) independently.
// For each, compute elevation distribution.
function statsFor(fieldKey, getValue) {
  const stats = new Map();
  for (let r = 0; r < H - 1; r++) {
    for (let c = 0; c < W - 1; c++) {
      const off = ARR_START + (r * W + c) * STRIDE;
      const v = getValue(off);
      if (!stats.has(v)) stats.set(v, { n: 0, hSum: 0, hMax: 0, hZero: 0 });
      const s = stats.get(v);
      const h = maxH(c, r);
      s.n++;
      s.hSum += h;
      if (h > s.hMax) s.hMax = h;
      if (h === 0) s.hZero++;
    }
  }
  console.log(`\n=== Stats per ${fieldKey} ===`);
  const arr = [...stats.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log(`  value          count   meanH   maxH   zeroH%`);
  for (const [v, s] of arr) {
    console.log(`  ${v.toString().padStart(15)}  ${s.n.toString().padStart(6)}   ${(s.hSum/s.n).toFixed(2).padStart(6)}  ${s.hMax.toString().padStart(4)}   ${(s.hZero*100/s.n).toFixed(1)}%`);
  }
}

statsFor('+16 (f16)', (off) => buf.readUInt32LE(off + 16));
statsFor('+20 (f20)', (off) => buf.readUInt32LE(off + 20));
statsFor('+24 (f24)', (off) => buf.readUInt32LE(off + 24));
statsFor('+28 (f28)', (off) => buf.readUInt32LE(off + 28));
statsFor('+32 (f32)', (off) => buf.readInt32LE(off + 32));

// Also check fields at other offsets — maybe a more informative field exists
statsFor('+84', (off) => buf.readUInt32LE(off + 84));
statsFor('+96', (off) => buf.readUInt32LE(off + 96));
