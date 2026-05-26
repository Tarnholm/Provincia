// dig-explore-grid-values-4.js — geometry resolution + sharper recency test
//
// -3 surprise: odd "filler" rows are 47% non-zero -> they are NOT empty
// filler. Yet even-row-collapse gives a clean monotonic radial falloff.
// Resolve the geometry, then sharpen the recency/LOS test.
//
// Tests:
//  (A) Compare even-row grid vs odd-row grid: are odd rows a near-duplicate of
//      the even row above (interlaced same data) or independent? If duplicate,
//      true resolution is 510x700 and the engine just writes each tile twice
//      down the column (or it's a 510x1400 true grid).
//  (B) Best coord fit again but now also try gy mapping with full 1400 height.
//  (C) Sharper recency: NEW high cells (v>=5 in t7 but <=2 in t6) — are these
//      where the player MOVED a character to (present in t7, absent t6)?
//  (D) Decay rate fitted: of cells at exactly v=K in tN with NO refresh
//      (no neighbor rose), what is the t(N+1) value distribution? Pure decay.

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

const g7 = decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav')));

// (A) even vs odd row relationship
console.log('=== (A) even-row vs odd-row relationship ===');
{
  // Compare each odd row to the even row directly above it: how often equal?
  let equalAbove=0, tot=0, equalBelow=0;
  for (let y=1; y<GRID_H; y+=2) {
    for (let x=0;x<GRID_W;x++){
      const odd = g7[y*GRID_W+x];
      const above = g7[(y-1)*GRID_W+x];
      const below = y+1<GRID_H ? g7[(y+1)*GRID_W+x] : 0;
      tot++;
      if (odd===above) equalAbove++;
      if (odd===below) equalBelow++;
    }
  }
  console.log(`  odd cell == even row ABOVE: ${(100*equalAbove/tot).toFixed(1)}%`);
  console.log(`  odd cell == even row BELOW: ${(100*equalBelow/tot).toFixed(1)}%`);
  // value histograms even vs odd
  const he={}, ho={};
  for(let y=0;y<GRID_H;y++)for(let x=0;x<GRID_W;x++){
    const v=g7[y*GRID_W+x]; if(y%2===0) he[v]=(he[v]||0)+1; else ho[v]=(ho[v]||0)+1;
  }
  const fmt=h=>Object.keys(h).map(Number).sort((a,b)=>a-b).map(v=>`${v}:${h[v]}`).join(' ');
  console.log(`  even-row hist: ${fmt(he)}`);
  console.log(`  odd-row  hist: ${fmt(ho)}`);
}

// (B) coord fit using FULL grid, peaks v>=6, mapping cx=gx, cy=gy/2 vs round
console.log('\n=== (B) coord fit refinement (peaks v>=6, t7) ===');
{
  const chars = findChars(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav')));
  const pk=[];
  for(let y=0;y<GRID_H;y++)for(let x=0;x<GRID_W;x++) if(g7[y*GRID_W+x]>=6) pk.push({x,y});
  const maps = {
    'cx=gx,    cy=floor(gy/2)' : (x,y)=>[x, Math.floor(y/2)],
    'cx=gx,    cy=round(gy/2)' : (x,y)=>[x, Math.round(y/2)],
    'cx=gx,    cy=ceil(gy/2)'  : (x,y)=>[x, Math.ceil(y/2)],
  };
  for (const [name,fn] of Object.entries(maps)) {
    let within1=0,within0=0,n=0,sum=0;
    for(const p of pk){
      const [cx,cy]=fn(p.x,p.y);
      let best=Infinity;
      for(const c of chars){const d=Math.abs(c.x-cx)+Math.abs(c.y-cy); if(d<best)best=d;}
      sum+=best;n++; if(best===0)within0++; if(best<=1)within1++;
    }
    console.log(`  ${name}: n=${n} mean=${(sum/n).toFixed(2)} exact=${within0} within1=${within1}`);
  }
}

// (C) NEW high cells in t7 (v>=5, was <=2 in t6) co-located with chars that
//     are present in t7 but were ABSENT in t6 (the player moved there)?
console.log('\n=== (C) freshly-lit cells (t6<=2 -> t7>=5) near a newly-arrived char ===');
{
  const g6 = decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t6.sav')));
  const c6 = findChars(fs.readFileSync(path.join(SAVES_DIR,'save_t6.sav')));
  const c7 = findChars(fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav')));
  // present grids in char coords (gx=cx, gy=cy)
  const W=GRID_W, Hh=GRID_H/2;
  const p6=new Uint8Array(W*Hh), p7=new Uint8Array(W*Hh);
  for(const c of c6) if(c.x<W&&c.y<Hh) p6[c.y*W+c.x]=1;
  for(const c of c7) if(c.x<W&&c.y<Hh) p7[c.y*W+c.x]=1;
  let fresh=0, nearAnyChar7=0, nearNewChar=0;
  for(let i=0;i<g7.length;i++){
    if(!(g6[i]<=2 && g7[i]>=5)) continue;
    fresh++;
    const gx=i%W, gy=Math.floor(i/W);
    const cy=Math.floor(gy/2), cx=gx;
    // is there a t7 char within 2? a NEW char (t7 yes, t6 no) within 2?
    let any7=false, isNew=false;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const x=cx+dx,y=cy+dy; if(x<0||x>=W||y<0||y>=Hh)continue;
      if(p7[y*W+x]) any7=true;
      if(p7[y*W+x] && !p6[y*W+x]) isNew=true;
    }
    if(any7)nearAnyChar7++; if(isNew)nearNewChar++;
  }
  console.log(`  freshly-lit (t6<=2 -> t7>=5): ${fresh}`);
  console.log(`  ...within 2 of ANY t7 char: ${nearAnyChar7} (${(100*nearAnyChar7/fresh).toFixed(0)}%)`);
  console.log(`  ...within 2 of a NEWLY-ARRIVED char (t7 only): ${nearNewChar} (${(100*nearNewChar/fresh).toFixed(0)}%)`);
}

// (D) pure-decay distribution: cells at value K in t6 whose 8-neighbourhood
//     did NOT increase t6->t7 (no refresh). Where do they go?
console.log('\n=== (D) decay distribution for un-refreshed cells (t6->t7) ===');
{
  const g6 = decodePlayer(fs.readFileSync(path.join(SAVES_DIR,'save_t6.sav')));
  const W=GRID_W;
  function refreshed(i){
    const gx=i%W, gy=Math.floor(i/W);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const x=gx+dx,y=gy+dy; if(x<0||x>=W||y<0||y>=GRID_H)continue;
      const j=y*W+x; if(g7[j]>g6[j]) return true;
    }
    return false;
  }
  for (const K of [2,3,4,5,6,7]) {
    const dist={};
    let n=0;
    for(let i=0;i<g6.length;i++){
      if(g6[i]!==K) continue;
      if(refreshed(i)) continue;
      const to=g7[i]; dist[to]=(dist[to]||0)+1; n++;
    }
    const s=Object.keys(dist).map(Number).sort((a,b)=>a-b).map(v=>`${v}:${dist[v]}`).join(' ');
    console.log(`  un-refreshed v=${K} (n=${n}) -> ${s}`);
  }
}
