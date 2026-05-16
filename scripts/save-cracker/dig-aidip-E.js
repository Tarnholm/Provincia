// dig-aidip-E.js — Session 105/B
// Session 105/A FALSIFIED "LOS-halo-that-shifts-during-turn".
//   v=4..7 perfectly stable t11s→t11e; v=2 only 32 cells changed; v=3 only 81.
//
// New direction: examine the SPATIAL relationship between v=2/3/4 cells and
// player characters. If v=2/3/4 are static AI/scratch values (not live LOS),
// what are they?
//
// Tests:
//   1. For each v=2/3/4 cell, find nearest character. Distance distribution.
//      If mostly very close to chars => static "halo around army" but not
//      live. If random across map => threat zones / enemy halos /
//      destination markers.
//   2. Pick a coord mapping: M1 (gy=c.y) had the highest "char on v=1"
//      rate (~71%). Validate by looking at chars on v=2/3/4 — these should
//      be ENEMY chars (visible to player but on tiles the player has
//      glimpsed/threats).
//   3. The 32-cell shift for v=2 t11s→t11e: where are those 32 cells
//      spatially? Are they near characters that MOVED? Compare char list
//      between t11s and t11e — same UUIDs but different (x,y)?

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

// Step A: for ror_t11s, plot a small ASCII heatmap of v=2 cells with char
// positions overlaid. The halo location should align with army positions
// (if M1 mapping correct).
console.log('=== Spatial overlay: v=2/3/4 cells (.,o,*) vs character positions (X) on ror_t11s ===');
{
  const { buf, body } = loadPlayer('ror_t11s.sav');
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);

  // Build a small downsampled grid 64×80 covering the full strategic grid
  const DW = 80, DH = 64;
  const map = Array.from({length: DH}, () => new Array(DW).fill(0));
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const v = tiles[gy * GRID_W + gx];
      const dx = Math.floor(gx * DW / GRID_W);
      const dy = Math.floor(gy * DH / GRID_H);
      if (v === 2) map[dy][dx] = Math.max(map[dy][dx], 1);
      if (v === 3) map[dy][dx] = Math.max(map[dy][dx], 2);
      if (v === 4) map[dy][dx] = Math.max(map[dy][dx], 3);
      if (v === 5) map[dy][dx] = Math.max(map[dy][dx], 4);
      if (v >= 6) map[dy][dx] = Math.max(map[dy][dx], 5);
    }
  }
  // Overlay characters with M1 (gy = c.y, gx = c.x)
  const charBins = new Set();
  for (const c of chars) {
    const gx = c.x, gy = c.y;
    if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) continue;
    const dx = Math.floor(gx * DW / GRID_W);
    const dy = Math.floor(gy * DH / GRID_H);
    charBins.add(dy * DW + dx);
  }
  // Print top-down (low y at top — but grid stored bottom-up after session 103
  // flipY note; for this we just show as-stored)
  console.log('Legend: . = v=2, o = v=3, * = v=4, # = v=5, @ = v>=6, X = char position, _ = none');
  for (let dy = DH - 1; dy >= 0; dy--) {
    let line = '';
    for (let dx = 0; dx < DW; dx++) {
      const hasChar = charBins.has(dy * DW + dx);
      const m = map[dy][dx];
      if (hasChar) line += 'X';
      else if (m === 0) line += '_';
      else if (m === 1) line += '.';
      else if (m === 2) line += 'o';
      else if (m === 3) line += '*';
      else if (m === 4) line += '#';
      else line += '@';
    }
    console.log(line);
  }
}

// Step B: Distance distribution from v=2/3/4 cells to nearest character (M1).
console.log('\n=== Distance from v=2/3/4 cells to nearest character (M1 mapping: gx=c.x, gy=c.y) ===');
for (const file of ['ror_t11s.sav', 'athens_t22e.sav']) {
  const { buf, body } = loadPlayer(file);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  console.log(`\n--- ${file} (${chars.length} chars) ---`);
  for (const v of [2, 3, 4, 5]) {
    // Collect a sample of cells with this value
    const cells = [];
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (tiles[gy * GRID_W + gx] === v) cells.push([gx, gy]);
      }
    }
    if (cells.length === 0) { console.log(`  v=${v}: count=0`); continue; }
    const sample = cells.length > 500 ? cells.filter((_,i) => i % Math.floor(cells.length/500) === 0) : cells;
    let near1 = 0, near2 = 0, near4 = 0, near8 = 0, near16 = 0, near32 = 0;
    let sumD = 0;
    for (const [cx, cy] of sample) {
      let best = Infinity;
      for (const c of chars) {
        const dx = c.x - cx, dy = c.y - cy;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < best) best = d;
      }
      sumD += best;
      if (best <= 1) near1++;
      if (best <= 2) near2++;
      if (best <= 4) near4++;
      if (best <= 8) near8++;
      if (best <= 16) near16++;
      if (best <= 32) near32++;
    }
    const n = sample.length;
    console.log(`  v=${v}: total=${cells.length}, sampled=${n}, meanDist=${(sumD/n).toFixed(2)}, ` +
      `≤1:${(100*near1/n).toFixed(1)}% ≤2:${(100*near2/n).toFixed(1)}% ≤4:${(100*near4/n).toFixed(1)}% ` +
      `≤8:${(100*near8/n).toFixed(1)}% ≤16:${(100*near16/n).toFixed(1)}% ≤32:${(100*near32/n).toFixed(1)}%`);
  }
}

// Step C: What does t11s→t11e actually shift? List the 32+81 changing cells
// and their (gx,gy). Compare to any character that moved during the turn.
console.log('\n=== t11s→t11e: per-cell shifts in v=2 and v=3 ===');
{
  const a = loadPlayer('ror_t11s.sav');
  const b = loadPlayer('ror_t11e.sav');
  const ta = decodeRle(a.body.slice(ZONE_START, ZONE_END));
  const tb = decodeRle(b.body.slice(ZONE_START, ZONE_END));
  const charsA = findAllCharacterPositions(a.buf);
  const charsB = findAllCharacterPositions(b.buf);
  // Map UUIDs to (x,y) for both saves
  const posA = new Map(); for (const c of charsA) posA.set(c.uuid, c);
  const posB = new Map(); for (const c of charsB) posB.set(c.uuid, c);
  // Find chars that moved during the turn
  const moved = [];
  for (const [uuid, cb] of posB) {
    const ca = posA.get(uuid);
    if (!ca) continue;
    if (ca.x !== cb.x || ca.y !== cb.y) {
      moved.push({ uuid, fromX: ca.x, fromY: ca.y, toX: cb.x, toY: cb.y });
    }
  }
  console.log(`Characters that moved during turn 11: ${moved.length}`);
  if (moved.length > 0) {
    for (const m of moved.slice(0, 20)) {
      console.log(`  uuid=${m.uuid.toString(16)}  (${m.fromX},${m.fromY}) -> (${m.toX},${m.toY})`);
    }
  }

  // Find shifting cells
  const minLen = Math.min(ta.length, tb.length);
  for (const v of [2, 3]) {
    const shifts = [];
    for (let i = 0; i < minLen; i++) {
      const a1 = ta[i] === v, b1 = tb[i] === v;
      if (a1 !== b1) {
        const gx = i % GRID_W;
        const gy = Math.floor(i / GRID_W);
        shifts.push({ gx, gy, t11s: ta[i], t11e: tb[i] });
      }
    }
    console.log(`\nv=${v} shifts: ${shifts.length} cells`);
    for (const s of shifts.slice(0, 30)) {
      console.log(`  (gx=${s.gx}, gy=${s.gy})  t11s=v${s.t11s} → t11e=v${s.t11e}`);
    }
  }

  // Where did moving chars go? Plot their tile positions and check if shifts
  // are near them.
  if (moved.length > 0) {
    console.log('\nShift cells vs moved-char positions: nearest-distance for each shift');
    const allShifts = [];
    for (const v of [2, 3]) {
      for (let i = 0; i < minLen; i++) {
        const a1 = ta[i] === v, b1 = tb[i] === v;
        if (a1 !== b1) {
          const gx = i % GRID_W, gy = Math.floor(i / GRID_W);
          allShifts.push({ gx, gy, v });
        }
      }
    }
    let totalDist = 0;
    for (const s of allShifts) {
      let best = Infinity;
      for (const m of moved) {
        const d1 = Math.sqrt((s.gx - m.fromX)**2 + (s.gy - m.fromY)**2);
        const d2 = Math.sqrt((s.gx - m.toX)**2 + (s.gy - m.toY)**2);
        const d = Math.min(d1, d2);
        if (d < best) best = d;
      }
      totalDist += best;
    }
    console.log(`  Mean nearest distance (shift cell → nearest moved-char from/to): ${(totalDist/allShifts.length).toFixed(2)}`);
  }
}
