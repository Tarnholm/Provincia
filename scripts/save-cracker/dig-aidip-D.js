// dig-aidip-D.js — Session 105/A
// LOS halo hypothesis test for values 2/3/4 in the player exploration grid.
//
// HYPOTHESIS: values 2,3,4 = active LOS halo around player armies/agents.
//   - Should be CLOSE TO army positions
//   - Should SHIFT when armies move (ror_t11s vs ror_t11e)
//   - Higher values closer to characters (concentric ring)
//
// Strategy: decode the grid at 510×1400, extract character (x,y) positions
// from the save (skipping enemy-faction characters using known faction
// record offset for the player), and measure mean distance from each v=2/3/4
// cell to the nearest player character.
//
// Need: map character (x,y) → grid (gx,gy). Character coords are in 0-500
// range (rtw "strategy tile" coords). Grid is 510×1400. Hypothesis:
//   gx = x  (direct match — coord units == strategy tile units)
//   gy = ??? — character y is 0-500 range, but grid is 1400 tall.
//
// Try multiple mapping candidates and pick the one where v=1 (explored)
// tiles are densest around player characters.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');
const { findCharacterRecords } = require('../../src/characterParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const PUB = path.join(__dirname, '..', '..', 'public');

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

// Load mod name lookups so character parser works
function loadNameLookup() {
  const candidates = [
    path.join(PUB, 'data', 'world', 'maps', 'campaign', 'imperial_campaign', 'descr_names_lookup.txt'),
    path.join(PUB, 'descr_names_lookup.txt'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf16le');
      const lines = raw.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
      return lines;
    }
  }
  return null;
}

function loadTraitNames() {
  const candidates = [
    path.join(PUB, 'data', 'export_descr_character_traits.txt'),
    path.join(PUB, 'export_descr_character_traits.txt'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      // Quick parse: lines starting with `Trait    NAME`
      const txt = fs.readFileSync(p, 'utf8');
      const out = [];
      const re = /^Trait\s+(\S+)/gm;
      let m; while ((m = re.exec(txt))) out.push(m[1]);
      return out;
    }
  }
  return null;
}

// Find all character positions from save buffer using broader scan.
// Use the buildPositionIndex-style scan (we don't need the full character
// records — just (x,y) for any "type-6" record).
function findAllCharacterPositions(buf) {
  // Replicate the filter from buildPositionIndex but without UUID filter.
  // Type-6 records: hdr u32 at -4 must be 6 (or 4 in some cases).
  // x at +8, y at +12, both in (1..500). mp at +58 float.
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
    out.push({ offset: i, uuid: u, x, y, mp, hdr });
  }
  return out;
}

function valueAtFlipY(tiles, gx, gy) {
  // flipY from session 103: stored top-down vs TGA bottom-up; in 510×1400
  // the same flipY relationship should hold: row 0 in stored grid is the
  // SOUTH edge. For matching geography in the strategic grid where
  // character y=high is NORTH (based on RTW convention), we'd map
  // storedRow = (GRID_H - 1 - displayRow).
  // We'll try multiple mappings.
  const idx = gy * GRID_W + gx;
  if (idx < 0 || idx >= tiles.length) return -1;
  return tiles[idx];
}

// Player faction is the BIGGEST faction record. Find player record in
// `recs` array, return its index (= faction id).
function findPlayerFactionIdx(recs) {
  let bi = 0, bs = 0;
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].size > bs) { bs = recs[i].size; bi = i; }
  }
  return bi;
}

// For each save, decode grid + find char positions + compute stats.
function analyze(file, mapping) {
  const { buf, recs, body } = loadPlayer(file);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  const playerIdx = findPlayerFactionIdx(recs);

  // For halo test we need ONLY player characters. Without strict faction
  // attribution, we'll use a proxy: for each char find the nearest
  // ever-explored land tile (v=1) — player chars will be standing on/near
  // v=1 in their own territory. Enemy chars at start are surrounded by v=0
  // from the player's perspective.
  const playerChars = [];
  for (const c of chars) {
    // For each mapping, check whether the character is standing on v=1.
    const gx = mapping.gx(c.x);
    const gy = mapping.gy(c.y);
    if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) continue;
    const v = tiles[gy * GRID_W + gx];
    if (v === 1 || v === 2 || v === 3) {
      // Standing on explored / halo — likely player or visible to player.
      playerChars.push({ ...c, gx, gy, v });
    }
  }
  return { tiles, chars, playerChars, recs, playerIdx };
}

// Bin v=2/3/4 cells and find centroid + distances to nearest playerChar.
function centroidAndDist(tiles, playerChars, value) {
  const cells = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (tiles[gy * GRID_W + gx] === value) cells.push([gx, gy]);
    }
  }
  if (cells.length === 0) return null;
  let cx = 0, cy = 0;
  for (const [x, y] of cells) { cx += x; cy += y; }
  cx /= cells.length; cy /= cells.length;

  // For each cell, find nearest character. Then aggregate.
  let totalNearestDist = 0, near8 = 0, near4 = 0;
  if (playerChars.length > 0) {
    // Sample up to 1000 cells for speed
    const sample = cells.length > 1000 ? cells.filter((_, i) => (i * 1000 / cells.length | 0) !== ((i-1) * 1000 / cells.length | 0)) : cells;
    for (const [x, y] of sample) {
      let best = Infinity;
      for (const pc of playerChars) {
        const dx = x - pc.gx, dy = y - pc.gy;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < best) best = d;
      }
      totalNearestDist += best;
      if (best <= 4) near4++;
      if (best <= 8) near8++;
    }
    return {
      count: cells.length,
      centroid: [cx, cy],
      meanNearestDist: totalNearestDist / sample.length,
      pctWithin4: 100 * near4 / sample.length,
      pctWithin8: 100 * near8 / sample.length,
      sampleSize: sample.length,
    };
  }
  return { count: cells.length, centroid: [cx, cy], meanNearestDist: null };
}

// ===== Try several char→grid coord mappings =====
// gx = c.x  (510-wide grid matches 0-500 char x directly)
// gy candidates:
//   M1: gy = c.y   (assume bottom-up, then flipY)
//   M2: gy = GRID_H - 1 - c.y         (top-down)
//   M3: gy = 2 * c.y                  (Y is 2x scaled — 1400 tall vs 700)
//   M4: gy = GRID_H - 1 - 2*c.y       (top-down + 2x scale)
//   M5: gy = c.y * GRID_H / 300       (assume RTW Y max ~300)
const mappings = [
  { name: 'M1 c.y',                   gx: x => x,             gy: y => y },
  { name: 'M2 H-1-c.y',               gx: x => x,             gy: y => GRID_H - 1 - y },
  { name: 'M3 2*c.y',                 gx: x => x,             gy: y => 2 * y },
  { name: 'M4 H-1-2*c.y',             gx: x => x,             gy: y => GRID_H - 1 - 2 * y },
];

console.log('=== Step 1: find coord mapping by checking how often chars stand on v=1 ===');
console.log('(player chars should be on v=1 (explored land); enemy chars often on v=0 (unseen))\n');
for (const file of ['save_10_fresh.sav', 'ror_t11s.sav']) {
  const { buf, body } = loadPlayer(file);
  const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
  const chars = findAllCharacterPositions(buf);
  console.log(`--- ${file}: ${chars.length} chars found ---`);
  for (const m of mappings) {
    let on0 = 0, on1 = 0, on2 = 0, on3 = 0, on4 = 0, onOther = 0, oob = 0;
    for (const c of chars) {
      const gx = m.gx(c.x), gy = m.gy(c.y);
      if (gx < 0 || gx >= GRID_W || gy < 0 || gy >= GRID_H) { oob++; continue; }
      const v = tiles[gy * GRID_W + gx];
      if (v === 0) on0++;
      else if (v === 1) on1++;
      else if (v === 2) on2++;
      else if (v === 3) on3++;
      else if (v === 4) on4++;
      else onOther++;
    }
    console.log(`  ${m.name.padEnd(16)}  on v=0:${on0}  v=1:${on1}  v=2:${on2}  v=3:${on3}  v=4:${on4}  other:${onOther}  oob:${oob}`);
  }
  console.log();
}

console.log('\n=== Step 2: ror_t11s vs ror_t11e — same turn, start vs end ===');
console.log('If 2/3/4 are LIVE LOS halo, the cells should shift with army movement.');
console.log('Compare per-value counts AND distinct cell sets:\n');
{
  const a = loadPlayer('ror_t11s.sav');
  const b = loadPlayer('ror_t11e.sav');
  const ta = decodeRle(a.body.slice(ZONE_START, ZONE_END));
  const tb = decodeRle(b.body.slice(ZONE_START, ZONE_END));
  const minLen = Math.min(ta.length, tb.length);

  for (const v of [2, 3, 4, 5, 6, 7]) {
    let cntA = 0, cntB = 0, both = 0, onlyA = 0, onlyB = 0;
    for (let i = 0; i < minLen; i++) {
      const a1 = ta[i] === v, b1 = tb[i] === v;
      if (a1) cntA++;
      if (b1) cntB++;
      if (a1 && b1) both++;
      else if (a1) onlyA++;
      else if (b1) onlyB++;
    }
    const jaccard = (both + onlyA + onlyB) > 0 ? both / (both + onlyA + onlyB) : 0;
    console.log(`  v=${v}: t11s=${cntA}  t11e=${cntB}  both=${both}  onlyT11s=${onlyA}  onlyT11e=${onlyB}  Jaccard=${jaccard.toFixed(3)}`);
  }
}

console.log('\n=== Step 3: spatial centroid of v=2,3,4 in each save ===');
console.log('Then we cross-reference with army positions.\n');
{
  for (const file of ['save_10_fresh.sav', 'ror_t1e.sav', 'ror_t5.sav', 'ror_t11s.sav', 'ror_t11e.sav', 'athens_t22e.sav']) {
    const { buf, body } = loadPlayer(file);
    const tiles = decodeRle(body.slice(ZONE_START, ZONE_END));
    const chars = findAllCharacterPositions(buf);
    console.log(`--- ${file}: ${chars.length} chars ---`);
    // Compute centroid of char positions (avg x, avg y)
    let cx = 0, cy = 0;
    for (const c of chars) { cx += c.x; cy += c.y; }
    cx /= chars.length; cy /= chars.length;
    console.log(`  char centroid: (cx=${cx.toFixed(1)}, cy=${cy.toFixed(1)})  range x:[${Math.min(...chars.map(c=>c.x))}..${Math.max(...chars.map(c=>c.x))}] y:[${Math.min(...chars.map(c=>c.y))}..${Math.max(...chars.map(c=>c.y))}]`);
    for (const v of [2, 3, 4]) {
      let count = 0, sx = 0, sy = 0;
      for (let gy = 0; gy < GRID_H; gy++) {
        for (let gx = 0; gx < GRID_W; gx++) {
          if (tiles[gy * GRID_W + gx] === v) { count++; sx += gx; sy += gy; }
        }
      }
      if (count === 0) { console.log(`  v=${v}: count=0`); continue; }
      console.log(`  v=${v}: count=${count}  centroid grid: (gx=${(sx/count).toFixed(1)}, gy=${(sy/count).toFixed(1)})`);
    }
  }
}
