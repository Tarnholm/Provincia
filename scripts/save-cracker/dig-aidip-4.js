// dig-aidip-4.js — Session 103/D
// CONFIRMED via dig-aidip-3: the AI/diplo zone is a stride-2 <value, count>
// RLE encoding. Sum of counts ≈ 714,000 = 1020 × 700 = the RIS large map
// tile count. This is a per-tile grid encoded for the player faction.
//
// Now determine:
//  1. What are the possible "value" enum values? (0..0xff seen, but skewed
//     low — typical: 0,1,2,3,4,5,6,...)
//  2. What does each value represent? Likely candidates:
//     - tile fog-of-war state (unexplored / explored / visible)
//     - tile ownership: 0=neutral, 1=mine, 2=ally, 3=enemy, ...
//     - tile climate / terrain (5-7 climate types in RTW)
//  3. Compare ror_t1e vs ror_t11s: which value buckets grow?
//  4. Decode the full grid and write a PGM/PPM image to visually inspect it.

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

// Decode RLE Mode A: <value, count>
function decodeRle(zone) {
  const tiles = [];
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    for (let k = 0; k < c; k++) tiles.push(v);
  }
  return tiles;
}

// Per-value histogram
function valueHistOfRle(zone) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    hist[v] += c;
  }
  return hist;
}

// Compare value-bucket histograms across saves
const saves = [
  'save_10_fresh.sav',
  'save_1.2.sav',
  'ror_t1e.sav',
  'ror_t2s.sav',
  'ror_t5.sav',
  'ror_t11e.sav',
  'ror_t11s.sav',
  'athens_t21.sav',
  'athens_t22e.sav',
];

console.log(`=== Per-value bucket counts across saves (RLE Mode A) ===`);
console.log(`save                       v=0      v=1      v=2      v=3     v=4    v=5+   sumTotal`);
for (const s of saves) {
  const { body } = loadPlayer(s);
  const hist = valueHistOfRle(body.slice(ZONE_START, ZONE_END));
  const v5plus = hist.slice(5).reduce((a,b)=>a+b, 0);
  const sum = hist.reduce((a,b)=>a+b, 0);
  console.log(`  ${s.padEnd(24)}  ${hist[0].toString().padStart(6)}  ${hist[1].toString().padStart(6)}  ${hist[2].toString().padStart(6)}  ${hist[3].toString().padStart(6)}  ${hist[4].toString().padStart(5)}  ${v5plus.toString().padStart(5)}  ${sum}`);
}

// ===== Decode save_1.2 to a tile grid and try to render as image =====
console.log(`\n=== Decode save_1.2 to tile array ===`);
{
  const { body } = loadPlayer('save_1.2.sav');
  const zone = body.slice(ZONE_START, ZONE_END);
  const tiles = decodeRle(zone);
  console.log(`Decoded tile count: ${tiles.length}`);
  console.log(`Expected RIS large map: 1020 × 700 = ${1020 * 700}`);
  console.log(`Difference: ${tiles.length - 1020*700} (positive = excess)`);

  // try other dim candidates
  for (const [w, h] of [[1020, 700], [1024, 700], [1020, 701], [1020, 702], [1023, 700], [1024, 701]]) {
    const product = w * h;
    console.log(`  ${w} × ${h} = ${product}  diff=${tiles.length - product}`);
  }
}

// ===== Decode save_10_fresh and save_1.2, write PGM images =====
console.log(`\n=== Writing PGM visualizations ===`);
function writePgm(tiles, w, h, outPath) {
  if (tiles.length < w * h) {
    const padded = tiles.concat(new Array(w * h - tiles.length).fill(0));
    tiles = padded;
  }
  const header = `P5\n${w} ${h}\n255\n`;
  const buf = Buffer.alloc(header.length + w * h);
  buf.write(header, 0, 'ascii');
  for (let i = 0; i < w * h; i++) {
    // Scale 0..7 to 0..255 for visibility
    const v = tiles[i] || 0;
    buf[header.length + i] = Math.min(255, v * 32);
  }
  fs.writeFileSync(outPath, buf);
  console.log(`  wrote ${outPath}`);
}

const MAP_W = 1020;
const MAP_H = 700;
for (const s of ['save_10_fresh.sav', 'save_1.2.sav', 'ror_t1e.sav', 'ror_t11s.sav', 'athens_t22e.sav']) {
  const { body } = loadPlayer(s);
  const zone = body.slice(ZONE_START, ZONE_END);
  const tiles = decodeRle(zone);
  const base = s.replace(/\.sav$/, '');
  writePgm(tiles, MAP_W, MAP_H, path.join(__dirname, `out-aidip-grid-${base}.pgm`));
}

// ===== Cross-save value-shift check =====
// Compare two consecutive turns: which tiles change value?
console.log(`\n=== Per-tile diff: ror_t1e vs ror_t11s ===`);
{
  const a = loadPlayer('ror_t1e.sav');
  const b = loadPlayer('ror_t11s.sav');
  const tilesA = decodeRle(a.body.slice(ZONE_START, ZONE_END));
  const tilesB = decodeRle(b.body.slice(ZONE_START, ZONE_END));
  const minLen = Math.min(tilesA.length, tilesB.length);
  let diff = 0;
  const transitions = new Map(); // "v_from->v_to" -> count
  for (let i = 0; i < minLen; i++) {
    if (tilesA[i] !== tilesB[i]) {
      diff++;
      const k = `${tilesA[i]}->${tilesB[i]}`;
      transitions.set(k, (transitions.get(k) || 0) + 1);
    }
  }
  console.log(`Total differing tiles: ${diff} of ${minLen}`);
  const top = [...transitions.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15);
  for (const [k, c] of top) console.log(`  ${k}  count=${c}`);
}

// 1-tile move pair: per-tile diff should be ZERO
console.log(`\n=== Per-tile diff: save_mp_before vs save_mp_after (1-tile move) ===`);
{
  const a = loadPlayer('save_mp_before.sav');
  const b = loadPlayer('save_mp_after.sav');
  const tilesA = decodeRle(a.body.slice(ZONE_START, ZONE_END));
  const tilesB = decodeRle(b.body.slice(ZONE_START, ZONE_END));
  const minLen = Math.min(tilesA.length, tilesB.length);
  let diff = 0;
  for (let i = 0; i < minLen; i++) {
    if (tilesA[i] !== tilesB[i]) diff++;
  }
  console.log(`Total differing tiles: ${diff} of ${minLen}`);
}
