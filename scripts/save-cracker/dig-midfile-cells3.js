// Mid-file cells correlation, but with correct map scale (2041×1401 for heights/groundtypes/climates).
// Also: fix RLE-TGA reader.

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
  console.log(`  TGA: ${p.split(/[/\\]/).pop()} ${w}x${h} ${depth}bpp type=${imgType} topDown=${topDown}`);

  let pixelData;
  if (imgType === 2 || imgType === 3) {
    pixelData = buf.subarray(dataStart);
  } else if (imgType === 10 || imgType === 11) {
    // RLE
    pixelData = Buffer.alloc(w * h * channels);
    let src = dataStart;
    let dst = 0;
    while (dst < pixelData.length) {
      const hdr = buf[src++];
      const n = (hdr & 0x7f) + 1;
      if (hdr & 0x80) {
        // run-length packet: n copies of next pixel
        const px = buf.subarray(src, src + channels);
        src += channels;
        for (let i = 0; i < n; i++) {
          px.copy(pixelData, dst);
          dst += channels;
        }
      } else {
        // raw packet: n raw pixels
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
  return { w, h, channels, depth, sample };
}

const heights = loadTga('C:/RIS/RIS/data/world/maps/base/map_heights.tga');
const features = loadTga('C:/RIS/RIS/data/world/maps/base/map_features.tga');
const climates = loadTga('C:/RIS/RIS/data/world/maps/base/map_climates.tga');
const groundTypes = loadTga('C:/RIS/RIS/data/world/maps/base/map_ground_types.tga');

const data = JSON.parse(fs.readFileSync('C:/dev/Provincia/scripts/save-cracker/dig-midfile-cells1-out.json'));
const W = data.W, H = data.H;

// For each map, compute its own scale factor relative to the 1020x700 logical map
// (descr_terrain.txt says 1020x700 is the world size).
function makeMapper(map) {
  // Map a (col, row) in the 240x238 grid to a pixel in this map.
  const sx = map.w / W;
  const sy = map.h / H;
  return (c, r) => {
    const x = Math.floor((c + 0.5) * sx);
    const y = Math.floor((r + 0.5) * sy);
    return [x, y];
  };
}
const heightsM = makeMapper(heights);
const featuresM = makeMapper(features);
const climatesM = makeMapper(climates);
const groundTypesM = makeMapper(groundTypes);

function colorBin(rgb) { return rgb ? `${rgb[0]}_${rgb[1]}_${rgb[2]}` : 'null'; }
function heightBin(h) { return h ? Math.floor(h[0] / 16) * 16 : null; }

function computeStats(variants, mapper, sampler, binner) {
  const globalHist = new Map();
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const [x, y] = mapper(c, r);
      const v = binner(sampler(x, y));
      globalHist.set(v, (globalHist.get(v) || 0) + 1);
    }
  }
  const total = W * H;
  const results = [];
  for (const variant of variants) {
    const hist = new Map();
    for (const cell of variant.cells) {
      const [x, y] = mapper(cell.c, cell.r);
      const v = binner(sampler(x, y));
      hist.set(v, (hist.get(v) || 0) + 1);
    }
    const ranked = [];
    for (const [v, n] of hist) {
      const expected = (globalHist.get(v) || 0) * variant.cells.length / total;
      const factor = expected > 0 ? n / expected : (n > 0 ? Infinity : 0);
      ranked.push({ v, n, expected, factor });
    }
    ranked.sort((a, b) => (b.factor * Math.min(b.n, 10)) - (a.factor * Math.min(a.n, 10)));
    results.push({ variant: variant.variant, count: variant.cells.length, top: ranked.slice(0, 5) });
  }
  return results;
}

console.log(`\n--- Heights (16-bin) correlation per variant (scale ${heights.w}/${W} x ${heights.h}/${H}) ---`);
const hStats = computeStats(data.variants, heightsM, (x,y) => heights.sample(x,y), heightBin);
for (const r of hStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}

console.log(`\n--- Features correlation per variant (scale ${features.w}/${W} x ${features.h}/${H}) ---`);
const fStats = computeStats(data.variants, featuresM, (x,y) => features.sample(x,y), colorBin);
for (const r of fStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}

console.log(`\n--- Climates correlation per variant (scale ${climates.w}/${W} x ${climates.h}/${H}) ---`);
const cStats = computeStats(data.variants, climatesM, (x,y) => climates.sample(x,y), colorBin);
for (const r of cStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}

console.log(`\n--- GroundTypes correlation per variant (scale ${groundTypes.w}/${W} x ${groundTypes.h}/${H}) ---`);
const gStats = computeStats(data.variants, groundTypesM, (x,y) => groundTypes.sample(x,y), colorBin);
for (const r of gStats) {
  console.log(`  ${r.variant.padEnd(40)} n=${r.count}  top: ${r.top.map(t => `${t.v}: ${t.n}(${t.factor.toFixed(2)}x)`).join('  ')}`);
}
