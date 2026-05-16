// dig-aidip-G.js — Session 105/D
// Session 103 reported v≥5 = 244,534 in athens_t22e but 105/C only shows
// v=5: 162, v=6: 106, v=7: 3. The "v≥5 explosion" must be in much
// higher byte values. Look at the full histogram, then investigate.
//
// Also: 105/B revealed that gy=2*c.y is the correct mapping, and even
// rows hold the operational data while odd rows are mostly v=0 (scratch).
// So the operational grid is actually 510×700 — same as the TGA dim.
//
// Tests:
//   1. Print full histogram for athens_t22e — where are those 244,534 v≥5?
//   2. Are those high values on EVEN rows (data) or ODD rows (scratch)?
//   3. If high values are on odd-row scratch, they may be a separate
//      data stream interleaved into the grid storage.
//   4. Or: high values cluster in certain regions, e.g., enemy
//      territories the player has glimpsed.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const ZONE_START = 0x18;
const ZONE_END   = 0x0c264;
const GRID_W = 510;
const GRID_H = 1400;

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

function decodeRle(zone) {
  const tiles = [];
  for (let i = 0; i + 2 <= zone.length; i += 2) {
    const v = zone[i], c = zone[i+1];
    for (let k = 0; k < c; k++) tiles.push(v);
  }
  return tiles;
}

function findAllCharacterPositions(buf) {
  const out = [];
  for (let i = 100; i < buf.length - 64; i++) {
    const hdr = buf.readUInt32LE(i - 4);
    if (hdr !== 6 && hdr !== 4) continue;
    const u = buf.readUInt32LE(i);
    if (u === 0 || u === 0xffffffff) continue;
    const x = buf.readUInt32LE(i + 8);
    const y = buf.readUInt32LE(i + 12);
    if (x < 1 || x > 500 || y < 1 || y > 500) continue;
    const mp = buf.readFloatLE(i + 58);
    if (!isFinite(mp) || mp < 0 || mp > 1000) continue;
    out.push({ offset: i, uuid: u, x, y, mp });
  }
  return out;
}

// 1. Full histogram of values in each save
console.log('=== Full value histograms across saves (top values >=4) ===');
for (const file of ['save_10_fresh.sav', 'ror_t1e.sav', 'ror_t5.sav', 'ror_t11s.sav', 'ror_t11e.sav', 'athens_t21.sav', 'athens_t22e.sav']) {
  const { body } = loadPlayer(file);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const hist = new Array(256).fill(0);
  for (const v of tiles) hist[v]++;
  console.log(`\n--- ${file} ---`);
  const top = hist.map((c, v) => [v, c]).filter(([v, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  for (const [v, c] of top.slice(0, 24)) {
    console.log(`  v=${v.toString().padStart(3)} (0x${v.toString(16).padStart(2,'0')}): ${c}`);
  }
}

// 2. For athens_t22e, are high values on even or odd rows?
console.log('\n=== athens_t22e: parity analysis of cells by value ===');
{
  const { body } = loadPlayer('athens_t22e.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const evenH = new Array(256).fill(0);
  const oddH = new Array(256).fill(0);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const v = tiles[gy * GRID_W + gx];
      if ((gy & 1) === 0) evenH[v]++; else oddH[v]++;
    }
  }
  console.log(`  v  even-rows  odd-rows  even/total`);
  for (let v = 0; v < 16; v++) {
    const t = evenH[v] + oddH[v];
    if (t === 0) continue;
    console.log(`  v=${v.toString().padStart(2)}: even=${evenH[v]} odd=${oddH[v]} ratio=${(evenH[v]/t).toFixed(3)}`);
  }
  // Also high-value sums
  const evenHigh = evenH.slice(8).reduce((a, b) => a + b, 0);
  const oddHigh = oddH.slice(8).reduce((a, b) => a + b, 0);
  console.log(`  v≥8: even=${evenHigh} odd=${oddHigh} ratio=${(evenHigh/(evenHigh+oddHigh)).toFixed(3)}`);
}

// 3. Char halo: also check ror_t11s for parity
console.log('\n=== ror_t11s: parity by value ===');
{
  const { body } = loadPlayer('ror_t11s.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const evenH = new Array(256).fill(0);
  const oddH = new Array(256).fill(0);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const v = tiles[gy * GRID_W + gx];
      if ((gy & 1) === 0) evenH[v]++; else oddH[v]++;
    }
  }
  for (let v = 0; v < 16; v++) {
    const t = evenH[v] + oddH[v];
    if (t === 0) continue;
    console.log(`  v=${v.toString().padStart(2)}: even=${evenH[v]} odd=${oddH[v]} ratio=${(evenH[v]/t).toFixed(3)}`);
  }
}

// 4. What's the spatial distribution of v=8..15 in athens_t22e? Concentrated
// near armies or scattered?
console.log('\n=== athens_t22e: nearest-char distance for high-value cells (gx=c.x, gy=2*c.y) ===');
{
  const { buf, body } = loadPlayer('athens_t22e.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  // For each value-bucket, distance to nearest char
  for (const range of [[4,4], [5,5], [6,6], [7,7], [8,15], [16,31], [32,63], [64,127], [128,255]]) {
    const [lo, hi] = range;
    const cells = [];
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const v = tiles[gy * GRID_W + gx];
        if (v >= lo && v <= hi) cells.push([gx, gy, v]);
      }
    }
    if (cells.length === 0) continue;
    const step = Math.max(1, Math.floor(cells.length / 500));
    const sample = cells.filter((_, i) => i % step === 0);
    let sumD = 0, n2 = 0, n4 = 0, n8 = 0, n16 = 0;
    for (const [cx, cy] of sample) {
      let best = Infinity;
      for (const c of chars) {
        const dx = c.x - cx, dy = 2*c.y - cy;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < best) best = d;
      }
      sumD += best;
      if (best <= 2) n2++;
      if (best <= 4) n4++;
      if (best <= 8) n8++;
      if (best <= 16) n16++;
    }
    const n = sample.length;
    console.log(`  v=${lo}..${hi}: total=${cells.length}  sampled=${n}  meanDist=${(sumD/n).toFixed(2)}  ≤2:${(100*n2/n).toFixed(1)}% ≤4:${(100*n4/n).toFixed(1)}% ≤8:${(100*n8/n).toFixed(1)}% ≤16:${(100*n16/n).toFixed(1)}%`);
  }
}

// 5. ASCII overlay for athens_t22e, downsampled, showing high-value zones
console.log('\n=== athens_t22e: ASCII overlay (high values highlighted) ===');
{
  const { buf, body } = loadPlayer('athens_t22e.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  const DW = 80, DH = 64;
  const map = Array.from({length: DH}, () => new Array(DW).fill(0));
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const v = tiles[gy * GRID_W + gx];
      const dx = Math.floor(gx * DW / GRID_W);
      const dy = Math.floor(gy * DH / GRID_H);
      if (v >= 8) map[dy][dx] = Math.max(map[dy][dx], 4);
      else if (v >= 5) map[dy][dx] = Math.max(map[dy][dx], 3);
      else if (v >= 2) map[dy][dx] = Math.max(map[dy][dx], 2);
      else if (v === 1 && map[dy][dx] < 1) map[dy][dx] = 1;
    }
  }
  const charBins = new Set();
  for (const c of chars) {
    const gx = c.x, gy = 2 * c.y;
    if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) continue;
    const dx = Math.floor(gx * DW / GRID_W);
    const dy = Math.floor(gy * DH / GRID_H);
    charBins.add(dy * DW + dx);
  }
  console.log('Legend: _ v=0  . v=1  o v=2-4  * v=5-7  # v>=8  X char');
  for (let dy = DH - 1; dy >= 0; dy--) {
    let line = '';
    for (let dx = 0; dx < DW; dx++) {
      const m = map[dy][dx];
      const has = charBins.has(dy * DW + dx);
      if (has && m === 4) line += '@';
      else if (has) line += 'X';
      else if (m === 0) line += '_';
      else if (m === 1) line += '.';
      else if (m === 2) line += 'o';
      else if (m === 3) line += '*';
      else line += '#';
    }
    console.log(line);
  }
}
