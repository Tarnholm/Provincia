// dig-explore-grid-values-2.js — spatial test of the value field
//
// Findings from -1: everExplored(>=1) is strictly monotonic; high values
// (2..7) DECAY by ~1 per turn toward 1, and the total high-cell count SHRINKS
// over turns even though army count GROWS. This refutes "active LOS" (would
// grow with armies) and "AI scratch". The signature is a RECENCY counter:
// value = freshness of last sighting, ticking down ~1/turn to the "1" floor.
//
// This script tests the spatial side:
//  (A) Are the HIGHEST cells (peaks) co-located with the player's current
//      characters/settlements? (If recency: yes — just-seen tiles peak.)
//  (B) For cells that INCREASED turn N->N+1 (got refreshed), are they near a
//      character in turn N+1? (refresh = a unit re-saw that tile)
//  (C) Concentric falloff: around a peak, does value decline with radius?
//  (D) Map the grid coord system to character (x,y) coords.
//
// Diagnostics only.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const SAVES_DIR = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves';
const GRID_W = 510, GRID_H = 1400;
const RLE_REL = 0x18;

function decodePlayer(buf) {
  const recs = findFactionRecords(buf);
  let big = recs[0];
  for (const r of recs) if ((r.size||0) > (big.size||0)) big = r;
  const grid = new Uint8Array(GRID_W * GRID_H);
  const start = big.offset + RLE_REL;
  const max = Math.min(big.offset + big.size, buf.length);
  let gi = 0, i = start;
  while (i + 2 <= max && gi < grid.length) {
    const val = buf[i], count = buf[i+1];
    if (count === 0) break;
    const lim = Math.min(count, grid.length - gi);
    for (let k = 0; k < lim; k++) grid[gi+k] = val;
    gi += lim; i += 2;
  }
  return grid;
}

// crude character-position finder (same heuristic as session 105 scripts)
function findChars(buf) {
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
    out.push({ x, y, mp });
  }
  return out;
}

const FA = path.join(SAVES_DIR, 'save_t6.sav');
const FB = path.join(SAVES_DIR, 'save_t7.sav');
const bufA = fs.readFileSync(FA);
const bufB = fs.readFileSync(FB);
const gA = decodePlayer(bufA);
const gB = decodePlayer(bufB);
const charsB = findChars(bufB);
console.log(`t6 chars(approx)=${findChars(bufA).length}  t7 chars(approx)=${charsB.length}`);

// The grid is 510x1400. Char coords are ~1..400 (x) and ~1..400 (y).
// Header constants say logical 1020x700. The 510x1400 = same tile count.
// Hypothesis: gx = floor(charX/2)? or gx = charX/2 ; gy = charY*2.
// We'll just measure: for each peak (v>=6) in t7, what is the nearest char
// under several coord mappings, to discover the mapping.
function peaks(grid, minV) {
  const out = [];
  for (let gy = 0; gy < GRID_H; gy++)
    for (let gx = 0; gx < GRID_W; gx++)
      if (grid[gy*GRID_W+gx] >= minV) out.push({gx,gy,v:grid[gy*GRID_W+gx]});
  return out;
}
const pk = peaks(gB, 6);
console.log(`\n=== (D) coord-mapping discovery: peaks v>=6 in t7 = ${pk.length}, fit vs chars ===`);
// Candidate mappings from (gx,gy) -> (charX,charY)
const mappings = {
  'cx=gx, cy=gy/2'      : (gx,gy)=>[gx, gy/2],
  'cx=gx, cy=gy'        : (gx,gy)=>[gx, gy],
  'cx=gx*2, cy=gy/2'    : (gx,gy)=>[gx*2, gy/2],
  'cx=gx, cy=(GRID_H-gy)/2': (gx,gy)=>[gx, (GRID_H-gy)/2],
  'cx=gx*2, cy=(GRID_H-gy)/2': (gx,gy)=>[gx*2, (GRID_H-gy)/2],
};
for (const [name, fn] of Object.entries(mappings)) {
  let sum=0, n=0, within2=0;
  for (const p of pk.slice(0, 200)) {
    const [cx,cy] = fn(p.gx,p.gy);
    let best=Infinity;
    for (const c of charsB) {
      const d = Math.abs(c.x-cx)+Math.abs(c.y-cy);
      if (d<best) best=d;
    }
    sum+=best; n++; if (best<=2) within2++;
  }
  console.log(`  ${name.padEnd(28)} meanManhattan=${(sum/n).toFixed(1)}  within2=${within2}/${n}`);
}

// (B) cells that INCREASED t6->t7 (got refreshed). Are they near a t7 char?
console.log(`\n=== (B) refreshed cells (value rose t6->t7) co-located with t7 chars? ===`);
const risen = [];
for (let i = 0; i < gA.length; i++) {
  if (gB[i] > gA[i] && gB[i] >= 3) risen.push({i, from:gA[i], to:gB[i]});
}
console.log(`Cells that rose to >=3: ${risen.length}`);
// use best mapping found (we'll just report distribution under cx=gx,cy=gy/2)
{
  let near=0;
  for (const r of risen) {
    const gx = r.i % GRID_W, gy = Math.floor(r.i/GRID_W);
    const cx=gx, cy=gy/2;
    let best=Infinity;
    for (const c of charsB) { const d=Math.abs(c.x-cx)+Math.abs(c.y-cy); if(d<best)best=d; }
    if (best<=3) near++;
  }
  console.log(`  risen cells within Manhattan<=3 of a t7 char (cx=gx,cy=gy/2): ${near}/${risen.length}`);
}

// (C) concentric falloff: for each peak v>=6 in t7, walk outward (chebyshev
// rings) and report the mean value at each ring radius.
console.log(`\n=== (C) concentric falloff around peaks v>=6 (t7) ===`);
{
  const ringSum = new Array(10).fill(0), ringN = new Array(10).fill(0);
  for (const p of pk.slice(0, 300)) {
    for (let r = 0; r <= 8; r++) {
      let s=0,n=0;
      for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) {
        if (Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
        const nx=p.gx+dx, ny=p.gy+dy;
        if (nx<0||nx>=GRID_W||ny<0||ny>=GRID_H) continue;
        s+=gB[ny*GRID_W+nx]; n++;
      }
      if(n){ringSum[r]+=s/n; ringN[r]++;}
    }
  }
  for (let r=0;r<=8;r++) if(ringN[r]) console.log(`  ring r=${r}: meanValue=${(ringSum[r]/ringN[r]).toFixed(2)}`);
}

// (E) max value observed and where the very-high (8..11) cells sit — are they
// stable structural points (e.g., the player's capital) across all turns?
console.log(`\n=== (E) very-high cells (v>=8) positions across t0..t7 ===`);
{
  const files = ['save_t0.sav','save_t3.sav','save_t7.sav'];
  for (const f of files) {
    const g = decodePlayer(fs.readFileSync(path.join(SAVES_DIR,f)));
    const hi = [];
    for (let i=0;i<g.length;i++) if (g[i]>=8) hi.push({gx:i%GRID_W, gy:Math.floor(i/GRID_W), v:g[i]});
    console.log(`  ${f}: v>=8 cells=${hi.length}  sample: ` +
      hi.slice(0,12).map(c=>`(${c.gx},${c.gy})=${c.v}`).join(' '));
  }
}
