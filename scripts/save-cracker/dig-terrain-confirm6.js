// Session 22: Now with anti-diagonal sentinels filtered OUT, re-test the
// terrain correlation on the remaining 697 interior off-anti-diagonal cells.

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
const buf = fs.readFileSync(SAVE);

// Re-decode all
const cells = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const off = ARR_START + (r * W + c) * STRIDE;
    cells.push({
      c, r,
      f16: buf.readUInt32LE(off + 16),
      f20: buf.readUInt32LE(off + 20),
      f24: buf.readUInt32LE(off + 24),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
    });
  }
}

// Filter: off-anti-diagonal, not at right/bottom edge
const off = cells.filter(c => c.c !== 239 && c.r !== 237 && c.c + c.r !== 237);

// Sample heights at each cell's footprint
const sxH = heights.w / W, syH = heights.h / H;

function sampleCell(c, r) {
  const hx0 = Math.floor(c * sxH), hx1 = Math.floor((c + 1) * sxH);
  const hy0 = Math.floor(r * syH), hy1 = Math.floor((r + 1) * syH);
  let heightSum = 0, heightMax = 0, heightN = 0;
  let seaCount = 0, landCount = 0;
  for (let y = hy0; y < hy1; y++) {
    for (let x = hx0; x < hx1; x++) {
      const hg = heights.sample(x, y);
      if (hg) {
        if (hg[0] === 0 && hg[1] === 0 && hg[2] === 253) seaCount++;
        else {
          landCount++;
          heightSum += hg[0];
          if (hg[0] > heightMax) heightMax = hg[0];
          heightN++;
        }
      }
    }
  }
  return {
    seaPct: (seaCount + landCount) > 0 ? seaCount / (seaCount + landCount) : 0,
    heightMean: heightN > 0 ? heightSum / heightN : 0,
    heightMax,
  };
}

for (const c of off) c.a = sampleCell(c.c, c.r);

// Now group by field values
function statsBy(getKey, items) {
  const groups = new Map();
  for (const c of items) {
    const k = getKey(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  return groups;
}

function dump(label, groups) {
  console.log(`\n=== ${label} ===`);
  console.log(`  value | n   | seaPct | seaMaj% | hMean | hMax  | label`);
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [k, items] of sorted) {
    const seaPct = items.reduce((s, c) => s + c.a.seaPct, 0) / items.length;
    const seaMaj = items.filter(c => c.a.seaPct >= 0.5).length / items.length;
    const hLand = items.filter(c => c.a.heightMean > 0);
    const hMean = hLand.length ? hLand.reduce((s, c) => s + c.a.heightMean, 0) / hLand.length : 0;
    const hMax = items.reduce((s, c) => Math.max(s, c.a.heightMax), 0);
    console.log(`  ${String(k).padStart(10)} | ${String(items.length).padStart(3)} | ${seaPct.toFixed(3)} | ${(seaMaj*100).toFixed(1).padStart(6)}% | ${hMean.toFixed(2).padStart(5)} | ${String(hMax).padStart(5)}`);
  }
}

dump('f28 (off-anti-diagonal)', statsBy(c => c.f28, off));
dump('f20 (off-anti-diagonal)', statsBy(c => c.f20, off));
dump('f32 (off-anti-diagonal)', statsBy(c => c.f32, off));

// Most important: look at the variant key
console.log('\n=== off-anti-diagonal cells by full variant key ===');
const vh = new Map();
for (const c of off) {
  const k = `${c.f16}_${c.f20}_${c.f24}_${c.f28}_${c.f32}`;
  if (!vh.has(k)) vh.set(k, []);
  vh.get(k).push(c);
}
dump('variant', vh);

// CRITICAL TEST: is f28==54 actually sea/coast?
// Compare seaPct against canonical baseline.
const canon = off.filter(c => c.f28 === 6 && c.f20 === 200 && c.f32 === 200);
const f28_54 = off.filter(c => c.f28 === 54);
const f28_55 = off.filter(c => c.f28 === 55);
console.log(`\n=== sea/mountain interpretation test ===`);
console.log(`Canon (n=${canon.length}): mean seaPct=${(canon.reduce((s,c)=>s+c.a.seaPct,0)/canon.length).toFixed(3)}, mean height=${(canon.filter(c=>c.a.heightMean>0).reduce((s,c)=>s+c.a.heightMean,0) / canon.filter(c=>c.a.heightMean>0).length).toFixed(2)}`);
console.log(`f28=54 (n=${f28_54.length}): mean seaPct=${(f28_54.reduce((s,c)=>s+c.a.seaPct,0)/f28_54.length).toFixed(3)}, fully-sea=${f28_54.filter(c=>c.a.seaPct >= 0.5).length}/${f28_54.length}`);
console.log(`f28=55 (n=${f28_55.length}): mean height=${(f28_55.filter(c=>c.a.heightMean>0).reduce((s,c)=>s+c.a.heightMean,0) / Math.max(1,f28_55.filter(c=>c.a.heightMean>0).length)).toFixed(2)}, max height=${f28_55.reduce((s,c)=>Math.max(s,c.a.heightMax),0)}`);
