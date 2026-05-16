// dig-aidip-K.js — Session 105/H
// 105/G findings:
//   - Concentric halo around v=7/6 cells (radar falloff: v=7 closest,
//     v=2 outermost) confirmed
//   - 480/1644 v≥5 cells are STATIC across T0/T1e/T5 (not characters)
//   - 277 v≥5 cells in T5 only (= new settlements scouted)
//   - Most v=6 cells have NO character nearby (69%) — they're not on chars
//
// HYPOTHESIS: halo centers are SETTLEMENTS (regions/cities). Settlements
// provide passive LOS in RTW. Characters provide ADDITIONAL LOS halo.
//
// Strategy: extract settlement positions from the save (residences/regions
// have known structure) and verify halo centers are AT settlements.
//
// Without a settlement parser, we'll use a structural proxy:
//   - find the highest-v cell in each halo cluster (peak)
//   - check if many characters share that same (x, y) coord (= a city stack)
//   - check the stable-across-time set (480 cells) — these should be the
//     player's OWN settlements (always visible)

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
  let firstAscii = -1, start = -1;
  for (let i = 0; i < zone.length; i++) {
    const b = zone[i];
    if (b >= 0x20 && b <= 0x7e) {
      if (start < 0) start = i;
      if (i - start >= 5) { firstAscii = start; break; }
    } else { start = -1; }
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

// 1. Find true local peaks (cells where v ≥ all surrounding values)
console.log('=== save_10_fresh: identify TRUE local peaks (max in 9x9 neighborhood) ===');
{
  const { buf, body } = loadPlayer('save_10_fresh.sav');
  const tiles = decodeRleAutoEnd(body);
  const chars = findAllCharacterPositions(buf);

  const peaks = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const v = tiles[gy * GRID_W + gx];
      if (v < 6) continue;
      // check it's max in 9x9
      let isPeak = true;
      for (let dy = -4; dy <= 4 && isPeak; dy++) {
        for (let dx = -4; dx <= 4 && isPeak; dx++) {
          const ny = gy + dy, nx = gx + dx;
          if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
          if (tiles[ny * GRID_W + nx] > v) isPeak = false;
        }
      }
      if (isPeak) peaks.push({ gx, gy, v });
    }
  }
  console.log(`Found ${peaks.length} local peaks with v≥6.`);

  // For each peak, find chars at (gx, gy/2) within 1 tile (the peak source).
  let onChar = 0, onStack = 0, noChar = 0;
  for (const p of peaks) {
    const cy = p.gy / 2;
    let nearChars = chars.filter(c => Math.abs(c.x - p.gx) <= 1 && Math.abs(c.y - cy) <= 1);
    // Group by exact stack
    const exactStack = chars.filter(c => c.x === p.gx && c.y === Math.round(cy));
    if (exactStack.length > 1) onStack++;
    else if (nearChars.length > 0) onChar++;
    else noChar++;
  }
  console.log(`Peaks with stack (>1 char): ${onStack}, with single char nearby: ${onChar}, with no char: ${noChar}`);

  // Print first 20 peaks with coord + nearest-char info
  console.log('\nSample peaks:');
  for (const p of peaks.slice(0, 20)) {
    const cy = p.gy / 2;
    let near = null, dist = Infinity;
    for (const c of chars) {
      const d = Math.sqrt((c.x - p.gx)**2 + (c.y - cy)**2);
      if (d < dist) { dist = d; near = c; }
    }
    console.log(`  peak (${p.gx},${p.gy}) v=${p.v}  nearest char dist=${dist.toFixed(1)} at (${near.x},${near.y}) uuid=${near.uuid.toString(16)}`);
  }
}

// 2. Find clusters of v=4..7 (halo blobs). For each cluster, identify the
//    center coordinates. These should map to settlement positions.
console.log('\n=== save_10_fresh: cluster halo blobs and report centers ===');
{
  const { body } = loadPlayer('save_10_fresh.sav');
  const tiles = decodeRleAutoEnd(body);
  // BFS flood-fill on cells with v≥4 (consider 8-connectivity)
  const visited = new Uint8Array(GRID_W * GRID_H);
  const clusters = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const idx = gy * GRID_W + gx;
      if (visited[idx]) continue;
      if (tiles[idx] < 4) continue;
      // BFS
      const queue = [[gx, gy]];
      const cells = [];
      while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        const ci = cy * GRID_W + cx;
        if (visited[ci] || tiles[ci] < 4) continue;
        visited[ci] = 1;
        cells.push([cx, cy, tiles[ci]]);
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (dx === 0 && dy === 0) continue;
            const ny = cy + dy, nx = cx + dx;
            if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
            if (!visited[ny * GRID_W + nx]) queue.push([nx, ny]);
          }
        }
      }
      if (cells.length >= 3) clusters.push(cells);
    }
  }
  console.log(`Found ${clusters.length} halo clusters (v≥4, 8-connected with ±2 reach).`);
  // For each cluster, find the cell with the max value (the center)
  for (const cells of clusters.slice(0, 15)) {
    let maxV = 0, mx = 0, my = 0;
    for (const [x, y, v] of cells) {
      if (v > maxV) { maxV = v; mx = x; my = y; }
    }
    // Use centroid too
    let sx = 0, sy = 0;
    for (const [x, y] of cells) { sx += x; sy += y; }
    sx /= cells.length; sy /= cells.length;
    console.log(`  cluster size=${cells.length}  maxV=${maxV} at (${mx},${my})  centroid (${sx.toFixed(1)},${sy.toFixed(1)})`);
  }
}

// 3. Stable halo centers across saves should be PLAYER OWN settlements.
// Newly appearing centers should be ENEMY settlements just glimpsed.
console.log('\n=== Find stable halo centers (in all of T0, T1e, T5) ===');
{
  const sets = ['save_10_fresh.sav', 'ror_t1e.sav', 'ror_t5.sav'].map(f => {
    const { body } = loadPlayer(f);
    return decodeRleAutoEnd(body);
  });
  // For each cell, is it v≥5 in all 3?
  const stable = [];
  const t5only = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    const a = sets[0][i], b = sets[1][i], c = sets[2][i];
    if (a >= 5 && b >= 5 && c >= 5) stable.push(i);
    else if (a < 5 && b < 5 && c >= 5) t5only.push(i);
  }
  console.log(`Stable v≥5 cells (across T0/T1e/T5): ${stable.length}`);
  console.log(`T5-only v≥5 cells (new appearance): ${t5only.length}`);

  // List a few stable cell positions
  console.log('First 10 stable v≥5 cells:');
  for (const i of stable.slice(0, 10)) {
    const gx = i % GRID_W, gy = Math.floor(i / GRID_W);
    console.log(`  (${gx},${gy}) → char-coord (${gx},${gy/2})  v values: ${sets[0][i]},${sets[1][i]},${sets[2][i]}`);
  }
}

// 4. Big test: compute halo radius (distance from peak where v drops below 2).
console.log('\n=== Halo radius for sample peaks (save_10_fresh, v=7 cells) ===');
{
  const { body } = loadPlayer('save_10_fresh.sav');
  const tiles = decodeRleAutoEnd(body);
  const v7 = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      if (tiles[gy * GRID_W + gx] === 7) v7.push({ gx, gy });
    }
  }
  console.log(`v=7 cells: ${v7.length}`);
  // For each v7 cell, walk outward and record max-distance where v >= 4, >= 2
  let totalR4 = 0, totalR2 = 0, n = 0;
  for (const p of v7.slice(0, 30)) {
    let r4 = 0, r2 = 0;
    for (let r = 1; r <= 16; r++) {
      let any4 = false, any2 = false;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const ny = p.gy + dy, nx = p.gx + dx;
          if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
          const v = tiles[ny * GRID_W + nx];
          if (v >= 4) any4 = true;
          if (v >= 2) any2 = true;
        }
      }
      if (any4) r4 = r;
      if (any2) r2 = r;
    }
    totalR4 += r4;
    totalR2 += r2;
    n++;
  }
  console.log(`Mean halo radius (samples): r4 (v≥4 reaches)=${(totalR4/n).toFixed(2)}  r2 (v≥2 reaches)=${(totalR2/n).toFixed(2)}`);
}
