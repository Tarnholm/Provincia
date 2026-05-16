// dig-aidip-5.js — Session 103/E
// Test spatial alignment: does the RLE-decoded grid for the player faction
// match the actual geography of the RIS 1020×700 campaign map?
//
// Approach: read public/map_regions_large.tga (1020×700 RGB) to determine
// which pixels are land vs sea. Then for each saved grid:
//   - count tiles where (value, is_land) cross-tabulate
//   - if value 0 == sea and value !=0 == land, we have correlation.
//
// If alignment isn't perfect, try: (a) row reversal (TGA stored bottom-up),
// (b) ignore the 855-byte excess, (c) different starting offset.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;

function decodeRle(zone) {
  const tiles = [];
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    for (let k = 0; k < c; k++) tiles.push(v);
  }
  return tiles;
}

// Read TGA and convert to a land/sea mask. RIS map_regions_large.tga
// uses unique RGB per region, plus a sea color (we'll detect dominant
// outer-edge color = sea).
function loadTgaLandMask(file, w, h) {
  const buf = fs.readFileSync(file);
  const idLen = buf[0];
  const bpp = buf[16];
  const descr = buf[17];
  const dataOff = 18 + idLen;
  if (bpp !== 24) throw new Error('Expected 24-bit TGA');
  // Determine pixel order: bit 5 of descr = 1 → top-to-bottom; 0 → bottom-to-top
  const topDown = (descr & 0x20) !== 0;
  // Identify sea color by sampling the corner (0,0) of the rendered image
  // Pixel format BGR
  const pixOf = (x, y) => {
    const yy = topDown ? y : (h - 1 - y);
    const idx = dataOff + (yy * w + x) * 3;
    return (buf[idx] << 16) | (buf[idx+1] << 8) | buf[idx+2]; // BGR -> int
  };
  // Sea is likely the (0, h/2) edge pixel — try several candidates
  // and pick whichever is most common in row 0
  const colorCount = new Map();
  for (let x = 0; x < w; x++) {
    const c = pixOf(x, 0);
    colorCount.set(c, (colorCount.get(c) || 0) + 1);
  }
  const seaColor = [...colorCount.entries()].sort((a,b)=>b[1]-a[1])[0][0];
  console.log(`TGA: ${w}×${h} topDown=${topDown}  sea color (BGR int): 0x${seaColor.toString(16).padStart(6,'0')}  pixCount=${colorCount.get(seaColor)}`);
  // Build land mask
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      mask[y * w + x] = pixOf(x, y) === seaColor ? 0 : 1; // 0 = sea, 1 = land
    }
  }
  return mask;
}

const W = 1020;
const H = 700;
const landMask = loadTgaLandMask('public/map_regions_large.tga', W, H);

// Total land vs sea
let totalLand = 0;
for (let i = 0; i < landMask.length; i++) if (landMask[i]) totalLand++;
console.log(`Land tiles: ${totalLand} (${(100*totalLand/(W*H)).toFixed(1)}%)  Sea tiles: ${W*H - totalLand}`);

// For each save: cross-tabulate (value × land/sea) under different
// orientation hypotheses
function crossTab(tiles, mask, w, h, label, orientation) {
  // orientation: 'natural' | 'flipY' | 'flipX' | 'transpose'
  const total = Math.min(tiles.length, mask.length);
  const stats = { land: new Array(10).fill(0), sea: new Array(10).fill(0) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let srcX = x, srcY = y;
      if (orientation === 'flipY') srcY = h - 1 - y;
      else if (orientation === 'flipX') srcX = w - 1 - x;
      else if (orientation === 'flipBoth') { srcX = w - 1 - x; srcY = h - 1 - y; }
      const idx = srcY * w + srcX;
      if (idx >= tiles.length) continue;
      const v = Math.min(9, tiles[idx]);
      const m = mask[y * w + x];
      if (m) stats.land[v]++; else stats.sea[v]++;
    }
  }
  return stats;
}

const saves = ['save_10_fresh.sav', 'save_1.2.sav', 'ror_t11s.sav', 'athens_t22e.sav'];

for (const orient of ['natural', 'flipY', 'flipX', 'flipBoth']) {
  console.log(`\n=== Cross-tab (orientation: ${orient}) ===`);
  console.log(`save                       L0      L1      L2      L3+     S0      S1     S2+`);
  for (const s of saves) {
    const { body } = loadPlayer(s);
    const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
    const stats = crossTab(tiles, landMask, W, H, s, orient);
    const L0 = stats.land[0];
    const L1 = stats.land[1];
    const L2 = stats.land[2];
    const L3p = stats.land.slice(3).reduce((a,b)=>a+b,0);
    const S0 = stats.sea[0];
    const S1 = stats.sea[1];
    const S2p = stats.sea.slice(2).reduce((a,b)=>a+b,0);
    console.log(`  ${s.padEnd(24)}  ${L0.toString().padStart(6)}  ${L1.toString().padStart(6)}  ${L2.toString().padStart(6)}  ${L3p.toString().padStart(6)}  ${S0.toString().padStart(6)}  ${S1.toString().padStart(6)}  ${S2p.toString().padStart(6)}`);
  }
}

// Validation: a strong land/sea coupling means high concentration of value=0
// in sea (and a different value in land). If we see clean separation, that's
// proof of geographic mapping.
