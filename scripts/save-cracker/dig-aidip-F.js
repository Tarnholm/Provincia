// dig-aidip-F.js — Session 105/C
// STRONG candidate mapping found in 105/B: gy = 2*c.y.
//   - Char a1d839a3 moved (296,427) → (296,428).
//   - Shifts in v=2/3 at (gx≈293-302, gy=844-866).
//   - 2 × 427 = 854 — perfectly inside the shift cluster.
//
// VERIFY:
//   1. With M3 mapping (gx=c.x, gy=2*c.y), v=2/3/4 cell → nearest char
//      distance should be MUCH smaller than M1's 400+.
//   2. The 32+81 shifts should localize tightly around char a1d839a3
//      who moved (296,427→296,428).
//   3. Test on multiple saves — does the halo always center on chars?

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

// Test mapping: gy = 2*c.y, gx = c.x
function gxOf(c) { return c.x; }
function gyOf(c) { return 2 * c.y; }

// 1. With M3 mapping, distance from v=2/3/4 cells to nearest char
console.log('=== With mapping (gx=c.x, gy=2*c.y): mean distance v=N cell → nearest char ===');
for (const file of ['ror_t11s.sav', 'ror_t11e.sav', 'athens_t22e.sav', 'save_10_fresh.sav']) {
  const { buf, body } = loadPlayer(file);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  console.log(`\n--- ${file} (${chars.length} chars) ---`);
  for (const v of [2, 3, 4, 5, 6, 7]) {
    const cells = [];
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (tiles[gy * GRID_W + gx] === v) cells.push([gx, gy]);
      }
    }
    if (cells.length === 0) { console.log(`  v=${v}: count=0`); continue; }
    const step = Math.max(1, Math.floor(cells.length / 800));
    const sample = cells.filter((_, i) => i % step === 0);
    let near2 = 0, near4 = 0, near8 = 0, near16 = 0;
    let sumD = 0;
    for (const [cx, cy] of sample) {
      let best = Infinity;
      for (const c of chars) {
        const dx = gxOf(c) - cx, dy = gyOf(c) - cy;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < best) best = d;
      }
      sumD += best;
      if (best <= 2) near2++;
      if (best <= 4) near4++;
      if (best <= 8) near8++;
      if (best <= 16) near16++;
    }
    const n = sample.length;
    console.log(`  v=${v}: total=${cells.length}, sampled=${n}, meanDist=${(sumD/n).toFixed(2)}, ` +
      `≤2:${(100*near2/n).toFixed(1)}% ≤4:${(100*near4/n).toFixed(1)}% ≤8:${(100*near8/n).toFixed(1)}% ≤16:${(100*near16/n).toFixed(1)}%`);
  }
}

// 2. t11s→t11e shifts localized around moved characters
console.log('\n=== t11s→t11e shifts vs moved-char positions (with M3 mapping) ===');
{
  const a = loadPlayer('ror_t11s.sav');
  const b = loadPlayer('ror_t11e.sav');
  const ta = decodeRle(a.body.slice(ZONE_START, ZONE_END));
  const tb = decodeRle(b.body.slice(ZONE_START, ZONE_END));
  const charsA = findAllCharacterPositions(a.buf);
  const charsB = findAllCharacterPositions(b.buf);
  const posA = new Map(); for (const c of charsA) posA.set(c.uuid, c);
  const posB = new Map(); for (const c of charsB) posB.set(c.uuid, c);
  const moved = [];
  for (const [uuid, cb] of posB) {
    const ca = posA.get(uuid);
    if (!ca) continue;
    if (ca.x !== cb.x || ca.y !== cb.y) moved.push({ uuid, ca, cb });
  }
  console.log(`${moved.length} chars moved during the turn:`);
  for (const m of moved) {
    console.log(`  uuid=${m.uuid.toString(16)}  (${m.ca.x},${m.ca.y})→(${m.cb.x},${m.cb.y})  grid: (${gxOf(m.ca)},${gyOf(m.ca)})→(${gxOf(m.cb)},${gyOf(m.cb)})`);
  }

  // Find shifts and assign each to nearest moved char
  const minLen = Math.min(ta.length, tb.length);
  const shifts = [];
  for (let i = 0; i < minLen; i++) {
    if (ta[i] !== tb[i] && (ta[i] >= 2 || tb[i] >= 2)) {
      const gx = i % GRID_W, gy = Math.floor(i / GRID_W);
      shifts.push({ gx, gy, from: ta[i], to: tb[i] });
    }
  }
  console.log(`\nTotal shift cells (v=2/3 directional): ${shifts.length}`);
  let near8 = 0, near16 = 0;
  let sumD = 0;
  for (const s of shifts) {
    let best = Infinity;
    for (const m of moved) {
      // Distance to either endpoint (from-tile or to-tile)
      const d1 = Math.sqrt((s.gx - gxOf(m.ca))**2 + (s.gy - gyOf(m.ca))**2);
      const d2 = Math.sqrt((s.gx - gxOf(m.cb))**2 + (s.gy - gyOf(m.cb))**2);
      const d = Math.min(d1, d2);
      if (d < best) best = d;
    }
    sumD += best;
    if (best <= 8) near8++;
    if (best <= 16) near16++;
  }
  if (shifts.length > 0) {
    console.log(`Mean nearest dist (shift → nearest moved-char position): ${(sumD/shifts.length).toFixed(2)}`);
    console.log(`Within 8 tiles: ${near8}/${shifts.length} (${(100*near8/shifts.length).toFixed(1)}%)`);
    console.log(`Within 16 tiles: ${near16}/${shifts.length} (${(100*near16/shifts.length).toFixed(1)}%)`);
  }
}

// 3. Validate: a single character at high zoom — pick a known char,
// look at v=N pattern around them
console.log('\n=== Halo pattern around individual characters (ror_t11s, top 5 chars by uuid) ===');
{
  const { buf, body } = loadPlayer('ror_t11s.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  // Pick chars near the heavy halo zone: ones with c.x around 295, c.y around 425
  const candidates = chars.filter(c => c.x >= 290 && c.x <= 310 && c.y >= 420 && c.y <= 440).slice(0, 5);
  for (const c of candidates) {
    const gx = gxOf(c), gy = gyOf(c);
    console.log(`\nChar uuid=${c.uuid.toString(16)} at coord(${c.x},${c.y}) → grid(${gx},${gy})`);
    console.log('  ±10x10 grid neighborhood (gx-10..gx+10, gy-10..gy+10), legend: . _ X 1 2 3 4 # @');
    for (let dy = -10; dy <= 10; dy++) {
      let row = '  ';
      for (let dx = -10; dx <= 10; dx++) {
        const ny = gy + dy, nx = gx + dx;
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) { row += '.'; continue; }
        if (dx === 0 && dy === 0) { row += 'X'; continue; }
        const v = tiles[ny * GRID_W + nx];
        const ch = v === 0 ? '_' : v === 1 ? ' ' : v === 2 ? '2' : v === 3 ? '3' : v === 4 ? '4' : v === 5 ? '5' : '@';
        row += ch;
      }
      console.log(row);
    }
  }
}

// 4. Are the v=2/3/4 halos contiguous around chars? Compute: for each char,
// what fraction of cells within radius R have v=2/3/4?
console.log('\n=== Density of v=2/3/4 within radius R of each char (ror_t11s) ===');
{
  const { buf, body } = loadPlayer('ror_t11s.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  for (const R of [2, 4, 6, 8, 12]) {
    let totalTiles = 0;
    const counts = new Array(8).fill(0);
    for (const c of chars) {
      const gx = gxOf(c), gy = gyOf(c);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx*dx + dy*dy > R*R) continue;
          const ny = gy + dy, nx = gx + dx;
          if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
          const v = Math.min(7, tiles[ny * GRID_W + nx]);
          counts[v]++;
          totalTiles++;
        }
      }
    }
    console.log(`  R=${R}: tiles=${totalTiles}  v0:${counts[0]}(${(100*counts[0]/totalTiles).toFixed(1)}%)  ` +
      `v1:${counts[1]}(${(100*counts[1]/totalTiles).toFixed(1)}%)  ` +
      `v2:${counts[2]}(${(100*counts[2]/totalTiles).toFixed(1)}%)  ` +
      `v3:${counts[3]}(${(100*counts[3]/totalTiles).toFixed(1)}%)  ` +
      `v4:${counts[4]}(${(100*counts[4]/totalTiles).toFixed(1)}%)  ` +
      `v5+:${counts[5]+counts[6]+counts[7]}(${(100*(counts[5]+counts[6]+counts[7])/totalTiles).toFixed(1)}%)`);
  }
}
