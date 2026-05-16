// dig-aidip-J.js — Session 105/G
// PRIOR FINDINGS (105/F): "v≥5 explosion" was an artifact of decoding
// embedded ASCII building-type strings as RLE. With correct truncation:
//   - Decoded grid count = 714,000 ± in all saves (510×1400)
//   - v=8+ < 5 cells in all saves
//   - v=2/3 trends DOWN over campaign (30k→13k for v=2)
//   - v=4,5,6,7 stay near-stable
//
// Earlier (105/A,B,C) found gy = 2*c.y maps chars to grid:
//   - v=4/5/6/7 cluster within 8 tiles of chars (most >80% within 8)
//   - v=4..7 are 100% IDENTICAL between t11s and t11e — they DO NOT shift
//     during a turn. But they DO move with character movement across
//     turn boundaries.
//
// REMAINING QUESTIONS:
//   1. The halos move with chars across turns but not within a turn —
//      are they updated at TURN END only? Or only when game saves?
//   2. Are v=4/5/6/7 halos around the PLAYER's chars or AROUND ENEMY chars?
//      (Could be enemy LOS halo as seen by player, frozen at last view.)
//   3. Test by checking: do v=4/5/6/7 halos ever appear on tiles where
//      v=1 (ever-explored) is FALSE? If yes, that's "ghost LOS" of enemy.
//   4. Concentric structure: confirm the v=4 cell is INSIDE v=3 INSIDE v=2.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const ZONE_START = 0x18;
const GRID_W = 510;
const GRID_H = 1400;

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0]; for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, player: big, body: buf.slice(big.offset, big.offset + big.size), file };
}

function decodeRleAutoEnd(body) {
  const FIXED_END = 0x0c264;
  const zone = body.slice(ZONE_START, FIXED_END);
  // Find first ASCII run ≥ 6 chars
  let firstAscii = -1;
  let start = -1;
  for (let i = 0; i < zone.length; i++) {
    const b = zone[i];
    if (b >= 0x20 && b <= 0x7e) {
      if (start < 0) start = i;
      if (i - start >= 5) { firstAscii = start; break; }
    } else {
      start = -1;
    }
  }
  const rleEnd = firstAscii < 0 ? zone.length : firstAscii - (firstAscii % 2);
  const tiles = [];
  for (let i = 0; i + 2 <= rleEnd; i += 2) {
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

// 1. Concentric structure verification.
// Pick the highest-value cells (v=5,6,7) and look at their immediate
// neighbors. If concentric, the cells just outside should be lower-value.
console.log('=== Concentric structure check: ror_t11s, find high-v cells, list neighbors ===');
{
  const { buf, body } = loadPlayer('ror_t11s.sav');
  const tiles = decodeRleAutoEnd(body);
  // Find v=6 and v=7 cells
  const peaks = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const v = tiles[gy * GRID_W + gx];
      if (v >= 6) peaks.push({ gx, gy, v });
    }
  }
  console.log(`Found ${peaks.length} cells with v≥6`);
  for (const p of peaks.slice(0, 5)) {
    console.log(`\nPeak at (${p.gx},${p.gy}) v=${p.v}. 11x11 neighborhood:`);
    for (let dy = -5; dy <= 5; dy++) {
      let row = '  ';
      for (let dx = -5; dx <= 5; dx++) {
        const ny = p.gy + dy, nx = p.gx + dx;
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) { row += '?'; continue; }
        const v = tiles[ny * GRID_W + nx];
        if (dx === 0 && dy === 0) row += '#';
        else if (v === 0) row += '_';
        else if (v === 1) row += '.';
        else row += v.toString();
      }
      console.log(row);
    }
  }
}

// 2. Are halos around PLAYER chars or ENEMY chars? Test:
// - For each v≥4 cell, check whether the tile is on v=1 (ever-explored) or v=0.
//   If halos appear on v=0 tiles (unexplored), it's "frozen enemy LOS" view.
// - But wait, the SAME zone holds both — a cell can only have one value at
//   a time. So check: at the BOUNDARY of the v=4 ring, what's outside? v=0
//   or v=1? If v=0 outside, the halo is in unexplored territory (enemy?).
console.log('\n=== Are v=4/5/6/7 halos on land previously explored (v=1) or unexplored (v=0)? ===');
console.log('Check the ring SURROUNDING each halo center — what value dominates outside?');
{
  const { body } = loadPlayer('ror_t11s.sav');
  const tiles = decodeRleAutoEnd(body);
  // For each v≥4 center, count v at radius 8..12 (outside the halo)
  const peaks = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (tiles[gy * GRID_W + gx] >= 5) peaks.push({ gx, gy });
    }
  }
  const outsideHist = new Array(8).fill(0);
  for (const p of peaks) {
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const r = Math.sqrt(dx*dx + dy*dy);
        if (r < 8 || r > 12) continue;
        const ny = p.gy + dy, nx = p.gx + dx;
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
        const v = Math.min(7, tiles[ny * GRID_W + nx]);
        outsideHist[v]++;
      }
    }
  }
  console.log(`Ring r=8..12 around ${peaks.length} v≥5 centers:`);
  const total = outsideHist.reduce((a,b)=>a+b, 0);
  for (let v = 0; v < 8; v++) {
    console.log(`  v=${v}: ${outsideHist[v]} (${(100*outsideHist[v]/total).toFixed(1)}%)`);
  }
}

// 3. Are the v=4..7 halos near CHARACTERS but only certain ones?
// Specifically: characters of which faction? Without faction tagging
// we can check whether the halo center is near MANY chars (large army?)
// vs near a single isolated char.
console.log('\n=== For each v=6 cell, how many chars are within 4 tiles? ===');
{
  const { buf, body } = loadPlayer('ror_t11s.sav');
  const tiles = decodeRleAutoEnd(body);
  const chars = findAllCharacterPositions(buf);
  const peaks = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (tiles[gy * GRID_W + gx] === 6) peaks.push({ gx, gy });
    }
  }
  console.log(`v=6 peaks: ${peaks.length}`);
  const counts = peaks.map(p => {
    let n = 0;
    for (const c of chars) {
      const dx = c.x - p.gx, dy = 2*c.y - p.gy;
      if (dx*dx + dy*dy <= 16) n++;
    }
    return n;
  });
  // Distribution
  const histN = new Array(20).fill(0);
  for (const c of counts) histN[Math.min(19, c)]++;
  for (let i = 0; i < 20; i++) {
    if (histN[i] === 0) continue;
    console.log(`  ${i === 19 ? '≥19' : i.toString().padStart(3)} chars within 4 tiles: ${histN[i]}`);
  }
}

// 4. SIMPLER theory: are the halo centers on tiles that contain SETTLEMENTS?
// Settlements have characters on them (the governor). High-v cells could be
// LOS HALO around SETTLEMENTS (a settlement's own LOS extends ~4-6 tiles).
// Test: how often does a v=6 cell sit on a "Stack" of multiple chars
// (= a settlement governor + military commander + family members?)
console.log('\n=== STRONG TEST: v=4..7 halos vs settlement-style char stacks ===');
{
  const { buf, body } = loadPlayer('save_10_fresh.sav');
  const tiles = decodeRleAutoEnd(body);
  const chars = findAllCharacterPositions(buf);
  // Group chars by (x,y) — stacks = chars sharing position
  const stacks = new Map();
  for (const c of chars) {
    const k = c.x + ',' + c.y;
    if (!stacks.has(k)) stacks.set(k, []);
    stacks.get(k).push(c);
  }
  // Distribution of stack sizes
  const stackSizes = [...stacks.values()].map(s => s.length).sort((a,b)=>b-a);
  console.log(`Total stacks: ${stacks.size}, biggest sizes: ${stackSizes.slice(0,10).join(',')}`);
  // For each v=6 cell, is there a multi-char stack right under it?
  const peaks = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (tiles[gy * GRID_W + gx] === 6) peaks.push({ gx, gy });
    }
  }
  let withStack = 0, withSingle = 0, withNone = 0;
  for (const p of peaks) {
    // Find stack at (gx, gy/2) ± 1
    let best = 0;
    for (const [k, s] of stacks) {
      const [cx, cy] = k.split(',').map(Number);
      const dx = cx - p.gx, dy = 2*cy - p.gy;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 2) {
        if (s.length > best) best = s.length;
      }
    }
    if (best === 0) withNone++;
    else if (best === 1) withSingle++;
    else withStack++;
  }
  console.log(`v=6 cells: ${peaks.length} total; ${withStack} on stacks (>1 char), ${withSingle} on single char, ${withNone} no char nearby`);
}

// 5. Cross-save halo centers: do v=4..7 centers in same coord across saves?
console.log('\n=== Halo center stability: v=5/6/7 cells at same (gx,gy) across saves? ===');
{
  const a = decodeRleAutoEnd(loadPlayer('save_10_fresh.sav').body);
  const b = decodeRleAutoEnd(loadPlayer('ror_t1e.sav').body);
  const c = decodeRleAutoEnd(loadPlayer('ror_t5.sav').body);
  // Build (gx,gy) sets for v≥5 in each
  function highSet(tiles) {
    const s = new Set();
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] >= 5) s.add(i);
    }
    return s;
  }
  const sa = highSet(a), sb = highSet(b), sc = highSet(c);
  let aOnly = 0, bOnly = 0, cOnly = 0, ab = 0, abc = 0, ac = 0, bc = 0;
  const all = new Set([...sa, ...sb, ...sc]);
  for (const i of all) {
    const inA = sa.has(i), inB = sb.has(i), inC = sc.has(i);
    if (inA && inB && inC) abc++;
    else if (inA && inB) ab++;
    else if (inA && inC) ac++;
    else if (inB && inC) bc++;
    else if (inA) aOnly++;
    else if (inB) bOnly++;
    else if (inC) cOnly++;
  }
  console.log(`Total distinct cells: ${all.size}`);
  console.log(`In all 3: ${abc}, in T0+T1e: ${ab}, in T0+T5: ${ac}, in T1e+T5: ${bc}`);
  console.log(`T0 only: ${aOnly}, T1e only: ${bOnly}, T5 only: ${cOnly}`);
}
