// dig-aidip-7.js — Session 103/G
// dig-aidip-6 showed top region colors are all ~similar oranges (f98c29,
// fc8c29, e98c29, fb8c29, ...). Likely sea = "any pixel close to orange in
// RGB" or there's a Δ around antialiasing.
//
// Better: cluster the top-N colors as "sea" if their RGB differs from the
// modal sea color by <16 in each channel. Re-run the cross-tab.

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

function loadTgaRgb(file) {
  const buf = fs.readFileSync(file);
  const idLen = buf[0];
  const descr = buf[17];
  const topDown = (descr & 0x20) !== 0;
  const dataOff = 18 + idLen;
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

// Sea = pixels within RGB distance 24 of the modal color (f98c29 — orange).
const SEA_BASE = 0xf98c29;
const seaB = (SEA_BASE >>> 16) & 0xff;
const seaG = (SEA_BASE >>> 8) & 0xff;
const seaR = SEA_BASE & 0xff;
const mask = new Uint8Array(W * H); // 1 = land, 0 = sea
let totalLand = 0, totalSea = 0;
for (let i = 0; i < W * H; i++) {
  const c = rgb[i];
  const b = (c >>> 16) & 0xff;
  const g = (c >>> 8) & 0xff;
  const r = c & 0xff;
  const isSea = Math.abs(r - seaR) < 24 && Math.abs(g - seaG) < 24 && Math.abs(b - seaB) < 24;
  mask[i] = isSea ? 0 : 1;
  if (isSea) totalSea++; else totalLand++;
}
console.log(`Sea cluster (Δ<24 from 0xf98c29): land=${totalLand} (${(100*totalLand/(W*H)).toFixed(1)}%)  sea=${totalSea} (${(100*totalSea/(W*H)).toFixed(1)}%)`);

const saves = ['save_10_fresh.sav', 'save_1.2.sav', 'ror_t11s.sav', 'athens_t22e.sav'];

for (const s of saves) {
  const { body } = loadPlayer(s);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const n = Math.min(tiles.length, mask.length);
  const land = new Array(16).fill(0), sea = new Array(16).fill(0);
  for (let i = 0; i < n; i++) {
    const v = Math.min(15, tiles[i]);
    if (mask[i]) land[v]++; else sea[v]++;
  }
  const tot = (a) => a.reduce((x,y)=>x+y, 0);
  console.log(`\n${s}  (sea=${tot(sea)}, land=${tot(land)})`);
  console.log(`  v   :    on land    |   on sea       |  v's distribution`);
  for (let v = 0; v < 7; v++) {
    const total = land[v] + sea[v];
    const landPct = total ? (100*land[v]/total).toFixed(1) : 'n/a';
    const seaPct  = total ? (100*sea[v]/total).toFixed(1) : 'n/a';
    console.log(`  ${v}   :  ${land[v].toString().padStart(8)}  (${landPct.padStart(4)}%)   |  ${sea[v].toString().padStart(8)}  (${seaPct.padStart(4)}%)`);
  }
}

// What if the orientation is row-major vs column-major?
console.log(`\n=== Column-major orientation test (W,H swapped) ===`);
const W2 = 700, H2 = 1020;
function colMajorMask() {
  const m2 = new Uint8Array(W2 * H2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Standard (x, y) in 1020-wide row-major:
      // map this to (y, x) in 700-wide row-major
      m2[x * 700 + y] = mask[y * 1020 + x];
    }
  }
  return m2;
}
{
  const m2 = colMajorMask();
  for (const s of saves.slice(0, 2)) {
    const { body } = loadPlayer(s);
    const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
    const n = Math.min(tiles.length, m2.length);
    const land = new Array(8).fill(0), sea = new Array(8).fill(0);
    for (let i = 0; i < n; i++) {
      const v = Math.min(7, tiles[i]);
      if (m2[i]) land[v]++; else sea[v]++;
    }
    console.log(`\n[col-major] ${s}`);
    for (let v = 0; v < 5; v++) {
      const total = land[v] + sea[v];
      const seaPct = total ? (100*sea[v]/total).toFixed(1) : 'n/a';
      console.log(`  v=${v}: land=${land[v]} sea=${sea[v]} seaPct=${seaPct}%`);
    }
  }
}

// Try row-reversed (TGA is bottom-up, our grid might be top-down)
console.log(`\n=== Row-reversed test (grid flipY) ===`);
{
  const maskFlipY = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      maskFlipY[y * W + x] = mask[(H - 1 - y) * W + x];
    }
  }
  for (const s of saves) {
    const { body } = loadPlayer(s);
    const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
    const land = new Array(8).fill(0), sea = new Array(8).fill(0);
    const n = Math.min(tiles.length, maskFlipY.length);
    for (let i = 0; i < n; i++) {
      const v = Math.min(7, tiles[i]);
      if (maskFlipY[i]) land[v]++; else sea[v]++;
    }
    const tot = (a) => a.reduce((x,y)=>x+y, 0);
    console.log(`\n[flipY] ${s}  sea=${tot(sea)} land=${tot(land)}`);
    for (let v = 0; v < 5; v++) {
      const total = land[v] + sea[v];
      const seaPct = total ? (100*sea[v]/total).toFixed(1) : 'n/a';
      console.log(`  v=${v}: land=${land[v]} sea=${sea[v]} seaPct=${seaPct}%`);
    }
  }
}
