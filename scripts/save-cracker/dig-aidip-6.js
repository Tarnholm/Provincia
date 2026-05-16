// dig-aidip-6.js — Session 103/F
// Refine the spatial-alignment proof. dig-aidip-5 showed that in natural
// orientation, all "sea" (corner-color) tiles have value=1 — clean. But the
// corner-color detector was bad: 98.7% "land" is wrong.
//
// Better approach: read the TGA and find the TWO dominant outer-edge colors.
// In RIS, the impassable map borders should be one color, plus sea another.
// Or: scan the bottom-left corner and pick the dominant color in that area.
//
// Also: render a visual side-by-side. Write a PPM RGB image that overlays:
//   - the RLE grid value (as red channel)
//   - the TGA region color (as gray scale, half intensity)
// so we can eyeball alignment.

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

const W = 1020;
const H = 700;

// Read TGA RGB
function loadTgaRgb(file) {
  const buf = fs.readFileSync(file);
  const idLen = buf[0];
  const descr = buf[17];
  const topDown = (descr & 0x20) !== 0;
  const dataOff = 18 + idLen;
  // For each pixel return color packed as int
  const out = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const yy = topDown ? y : (H - 1 - y);
      const i = dataOff + (yy * W + x) * 3;
      const c = (buf[i] << 16) | (buf[i+1] << 8) | buf[i+2];
      out[y * W + x] = c;
    }
  }
  return out;
}

const rgb = loadTgaRgb('public/map_regions_large.tga');

// Find top 10 most common region colors across the whole map
const colorCount = new Map();
for (let i = 0; i < W * H; i++) {
  const c = rgb[i];
  colorCount.set(c, (colorCount.get(c) || 0) + 1);
}
const topColors = [...colorCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
console.log(`Total unique colors: ${colorCount.size}`);
console.log(`Top 10 colors by count:`);
for (const [c, n] of topColors) {
  // unpack to BGR (since we packed as B<<16|G<<8|R)
  console.log(`  0x${c.toString(16).padStart(6,'0')}  count=${n}  (${(100*n/(W*H)).toFixed(1)}%)`);
}

// Assume the largest color is sea (typically the case in TWS maps)
const seaColor = topColors[0][0];
const mask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) mask[i] = rgb[i] === seaColor ? 0 : 1;
let totalLand = 0;
for (let i = 0; i < mask.length; i++) if (mask[i]) totalLand++;
console.log(`Sea color = 0x${seaColor.toString(16).padStart(6,'0')}, land=${totalLand} (${(100*totalLand/(W*H)).toFixed(1)}%)  sea=${W*H - totalLand}`);

// Now cross-tab with the player grid (using natural orientation)
function decodeAndCrossTab(file, mask) {
  const { body } = loadPlayer(file);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const land = new Array(16).fill(0);
  const sea = new Array(16).fill(0);
  const n = Math.min(tiles.length, mask.length);
  for (let i = 0; i < n; i++) {
    const v = Math.min(15, tiles[i]);
    if (mask[i]) land[v]++; else sea[v]++;
  }
  return { land, sea, n };
}

const saves = ['save_10_fresh.sav', 'save_1.2.sav', 'ror_t11s.sav', 'athens_t22e.sav'];

console.log(`\n=== Cross-tab natural orientation (top color = sea) ===`);
for (const s of saves) {
  const ct = decodeAndCrossTab(s, mask);
  const totSea = ct.sea.reduce((a,b)=>a+b,0);
  const totLand = ct.land.reduce((a,b)=>a+b,0);
  console.log(`\n${s}  (sea=${totSea}, land=${totLand})`);
  console.log(`  v   :   on land   |  on sea`);
  for (let v = 0; v < 7; v++) {
    console.log(`  ${v}   :  ${ct.land[v].toString().padStart(8)}  |  ${ct.sea[v].toString().padStart(8)}  (sea share: ${ct.sea[v] ? (100*ct.sea[v]/(ct.land[v]+ct.sea[v])).toFixed(1) + '%' : '0.0%'})`);
  }
}

// ===== Write a side-by-side image =====
console.log(`\n=== Writing side-by-side comparison PPM (save_1.2 vs ror_t11s) ===`);
function writeComparisonPpm(saveA, saveB, outPath) {
  const ctA = decodeAndCrossTab(saveA, mask);
  const tA = decodeRle(loadPlayer(saveA).body.slice(ZONE_START, ZONE_END));
  const tB = decodeRle(loadPlayer(saveB).body.slice(ZONE_START, ZONE_END));
  // Triple-pane: TGA region colors | save A | save B
  const PANE_W = W;
  const SEP = 4;
  const TOTAL_W = PANE_W * 3 + SEP * 2;
  const TOTAL_H = H;
  const header = `P6\n${TOTAL_W} ${TOTAL_H}\n255\n`;
  const out = Buffer.alloc(header.length + TOTAL_W * TOTAL_H * 3);
  out.write(header, 0, 'ascii');
  // value -> color palette
  const palette = [
    [0, 0, 0],          // 0: black
    [80, 80, 80],       // 1: dark gray
    [180, 50, 50],      // 2: dark red
    [220, 130, 50],     // 3: orange
    [255, 220, 50],     // 4: yellow
    [80, 220, 80],      // 5: green
    [50, 50, 220],      // 6: blue
    [220, 220, 220],    // 7+: white
  ];
  const pal = v => palette[Math.min(v, 7)];
  for (let y = 0; y < H; y++) {
    for (let pane = 0; pane < 3; pane++) {
      for (let x = 0; x < W; x++) {
        const dstX = pane * (PANE_W + SEP) + x;
        const dstIdx = header.length + (y * TOTAL_W + dstX) * 3;
        if (pane === 0) {
          const c = rgb[y * W + x];
          out[dstIdx]     = (c >>> 16) & 0xff;
          out[dstIdx + 1] = (c >>> 8) & 0xff;
          out[dstIdx + 2] = c & 0xff;
        } else {
          const t = (pane === 1) ? tA : tB;
          const v = t[y * W + x] || 0;
          const p = pal(v);
          out[dstIdx]     = p[0];
          out[dstIdx + 1] = p[1];
          out[dstIdx + 2] = p[2];
        }
      }
    }
    // separators
    for (let pane = 0; pane < 2; pane++) {
      for (let xs = 0; xs < SEP; xs++) {
        const dstX = pane * (PANE_W + SEP) + PANE_W + xs;
        const dstIdx = header.length + (y * TOTAL_W + dstX) * 3;
        out[dstIdx] = 255; out[dstIdx + 1] = 255; out[dstIdx + 2] = 255;
      }
    }
  }
  fs.writeFileSync(outPath, out);
  console.log(`  wrote ${outPath} (${TOTAL_W}×${TOTAL_H})`);
}

writeComparisonPpm('save_1.2.sav', 'ror_t11s.sav', path.join(__dirname, 'out-aidip-compare.ppm'));
writeComparisonPpm('save_10_fresh.sav', 'athens_t22e.sav', path.join(__dirname, 'out-aidip-compare2.ppm'));
