// dig-explore-grid-values-3.js — even-row grid + recency-vs-LOS disambiguation
//
// From -2: coord map is charX=gx, charY=gy/2 (logical 510x700, real data on
// EVEN rows). Peaks (v>=6) sit on the player's characters (meanManhattan=2.5).
// Even-ring falloff is clean monotonic (6.4,4.5,3.7,2.9,2.0) -> spatial LOS.
// From -1: values decay ~1/turn toward 1; total high-cell count SHRINKS even
// as army count grows.
//
// This script:
//  (A) Collapse to true 510x700 (even rows only) and re-measure radial falloff
//      cleanly, plus the value-vs-distance-from-nearest-char relationship.
//  (B) Recency test: take tiles that are HIGH (>=4) in t6. Split into those
//      that STILL have a player char within 2 in t7 vs those that don't.
//      If recency/LOS: tiles that keep a char nearby stay high; tiles that
//      lost their char decay. Quantify.
//  (C) Confirm the value->meaning summary numerically.
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
// collapse 510x1400 -> 510x700 keeping EVEN logical rows (real data rows).
function evenRows(grid) {
  const H = GRID_H/2;
  const out = new Uint8Array(GRID_W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < GRID_W; x++)
      out[y*GRID_W+x] = grid[(y*2)*GRID_W + x];
  return out;
}
function oddRowStats(grid) {
  // confirm odd rows are filler (mostly 0)
  let nz=0, tot=0;
  for (let y=1; y<GRID_H; y+=2)
    for (let x=0;x<GRID_W;x++){ tot++; if(grid[y*GRID_W+x]!==0) nz++; }
  return {nz, tot, frac:nz/tot};
}
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
    out.push({ x, y });
  }
  return out;
}

const H = GRID_H/2; // 700

// confirm odd rows are filler
{
  const g = decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav')));
  const s = oddRowStats(g);
  console.log(`Odd-row (filler) non-zero fraction in t7: ${(s.frac*100).toFixed(3)}%  (${s.nz}/${s.tot})`);
}

// (A) even-row falloff vs radius, and value vs distance-from-nearest-char
console.log('\n=== (A) even-row (510x700) radial falloff around v>=6 peaks (t7) ===');
{
  const g = evenRows(decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav'))));
  const pk = [];
  for (let y=0;y<H;y++) for(let x=0;x<GRID_W;x++) if(g[y*GRID_W+x]>=6) pk.push({x,y});
  const ringSum=new Array(8).fill(0), ringN=new Array(8).fill(0);
  for (const p of pk.slice(0,300)) {
    for (let r=0;r<=6;r++){
      let s=0,n=0;
      for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
        if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
        const nx=p.x+dx,ny=p.y+dy;
        if(nx<0||nx>=GRID_W||ny<0||ny>=H)continue;
        s+=g[ny*GRID_W+nx];n++;
      }
      if(n){ringSum[r]+=s/n;ringN[r]++;}
    }
  }
  for(let r=0;r<=6;r++) if(ringN[r]) console.log(`  ring r=${r}: meanValue=${(ringSum[r]/ringN[r]).toFixed(2)}`);
}

// (B) recency-vs-LOS: high tiles in t6, do they decay if char left?
console.log('\n=== (B) high tiles (v>=4) in t6: stay high if char still near in t7? ===');
{
  const g6 = evenRows(decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t6.sav'))));
  const g7 = evenRows(decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav'))));
  const chars7 = findChars(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav')));
  // build a quick presence grid for chars7 (charX=gx, charY=gy)
  const present = new Uint8Array(GRID_W*H);
  for (const c of chars7) {
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const x=c.x+dx,y=c.y+dy;
      if(x>=0&&x<GRID_W&&y>=0&&y<H) present[y*GRID_W+x]=1;
    }
  }
  let keptNear=0, keptNearStayHigh=0, leftFar=0, leftFarDecayed=0;
  let sumDeltaNear=0, sumDeltaFar=0;
  for (let i=0;i<g6.length;i++){
    if (g6[i] < 4) continue;
    const delta = g7[i]-g6[i];
    if (present[i]) { keptNear++; sumDeltaNear+=delta; if (g7[i]>=g6[i]) keptNearStayHigh++; }
    else { leftFar++; sumDeltaFar+=delta; if (g7[i]<g6[i]) leftFarDecayed++; }
  }
  console.log(`  t6 v>=4 tiles WITH a t7 char within 2:    n=${keptNear}  meanDelta=${(sumDeltaNear/keptNear).toFixed(2)}  stayed>=prev=${keptNearStayHigh}/${keptNear} (${(100*keptNearStayHigh/keptNear).toFixed(0)}%)`);
  console.log(`  t6 v>=4 tiles WITHOUT a t7 char within 2:  n=${leftFar}  meanDelta=${(sumDeltaFar/leftFar).toFixed(2)}  decayed=${leftFarDecayed}/${leftFar} (${(100*leftFarDecayed/leftFar).toFixed(0)}%)`);
  console.log('  -> If recency/LOS: tiles with a char nearby keep/refresh value;');
  console.log('     tiles where the char left decay. Compare the two meanDeltas.');
}

// (C) Final numeric summary of the decay distribution per source value (t6->t7)
console.log('\n=== (C) per-source-value mean step (t6->t7, even rows, all cells) ===');
{
  const g6 = evenRows(decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t6.sav'))));
  const g7 = evenRows(decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav'))));
  const sum={}, cnt={};
  for(let i=0;i<g6.length;i++){const v=g6[i]; sum[v]=(sum[v]||0)+(g7[i]-v); cnt[v]=(cnt[v]||0)+1;}
  for(const v of Object.keys(sum).map(Number).sort((a,b)=>a-b))
    console.log(`  from v=${v}: n=${cnt[v]}  meanStep=${(sum[v]/cnt[v]).toFixed(3)}`);
}
