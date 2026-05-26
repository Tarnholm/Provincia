// dig-explore-grid-values-5.js — confirm rise-under-active-LOS + land floor
//
// Model so far: value = visibility/recency intensity.
//   0 = never seen; 1 = ever-seen floor (monotonic, never reverts);
//   2..N = recently/actively seen, radial falloff from the sight source,
//          decays by exactly 1/turn when LOS is lost (D in -4).
// Remaining checks:
//  (A) Do cells RISE when a player char is parked on them? Compare value AT a
//      char's tile (active LOS) vs the global mean. Active-LOS tiles should be
//      high.
//  (B) Land floor: among v==1 cells, what fraction are land per map_regions?
//      (Re-confirm the "1 = ever-explored land" claim with the available
//      Provincia upscaled region map if present, else RIS map_regions.tga.)
//  (C) Max value vs sight-radius: highest values should be at settlements/big
//      stacks (larger LOS). Report top cells and their value.

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

const buf = fs.readFileSync(path.join(SAVES_DIR,'save_t7.sav'));
const g = decodePlayer(buf);
const chars = findChars(buf);
const W=GRID_W, Hh=GRID_H/2;

// (A) value AT char tiles (active LOS) — both even-row sample (gy=cy*2) and the
// max over the 2-row column band [cy*2, cy*2+1].
console.log('=== (A) grid value at player-char tiles (active LOS) vs global ===');
{
  let sumAt=0, nAt=0, atHist={};
  for (const c of chars) {
    if (c.x>=W || c.y>=Hh) continue;
    // take the max over the small column band around the char tile
    let m=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const x=c.x+dx, gy=c.y*2+ (dy>0?1:0);
      const yy=Math.max(0,Math.min(GRID_H-1, c.y*2+dy));
      if(x<0||x>=W) continue;
      const v=g[yy*W+x]; if(v>m)m=v;
    }
    sumAt+=m; nAt++; atHist[m]=(atHist[m]||0)+1;
  }
  // global mean over non-zero cells
  let gsum=0,gn=0;
  for(let i=0;i<g.length;i++){ if(g[i]>0){gsum+=g[i];gn++;} }
  const fmt=h=>Object.keys(h).map(Number).sort((a,b)=>a-b).map(v=>`${v}:${h[v]}`).join(' ');
  console.log(`  mean grid value at/near char tiles: ${(sumAt/nAt).toFixed(2)} (n=${nAt})`);
  console.log(`  mean grid value over all explored (>0) cells: ${(gsum/gn).toFixed(2)}`);
  console.log(`  value-at-char histogram: ${fmt(atHist)}`);
  const lit = Object.keys(atHist).map(Number).filter(v=>v>=2).reduce((a,v)=>a+atHist[v],0);
  console.log(`  chars whose tile is "actively lit" (v>=2): ${lit}/${nAt} (${(100*lit/nAt).toFixed(0)}%)`);
}

// (B) land floor check using whatever region map is available
console.log('\n=== (B) v==1 floor vs land (region map) ===');
{
  const candidates = [
    path.join(__dirname, '..', '..', 'public', 'map_regions_large.tga'),
    'C:\\RIS\\RIS\\data\\world\\maps\\base\\map_regions.tga',
  ];
  let mapPath=null;
  for (const c of candidates) if (fs.existsSync(c)) { mapPath=c; break; }
  if (!mapPath) { console.log('  no region map found, skipping'); }
  else {
    const t = fs.readFileSync(mapPath);
    const mw = t[12] | (t[13]<<8), mh = t[14] | (t[15]<<8), bpp=t[16];
    const idlen=t[0], imgtype=t[2];
    console.log(`  using ${path.basename(mapPath)}  ${mw}x${mh} bpp=${bpp} type=${imgtype}`);
    if (imgtype!==2) { console.log('  (not uncompressed truecolor; skipping pixel test)'); }
    else {
      const off=18+idlen, bytespp=bpp/8;
      // sea in RTW region map is usually a specific color; treat "very dark/black"
      // or pure-blue as sea. We'll classify land = not (b dominant & r,g low).
      function isLand(mx,my){
        // TGA stored bottom-up unless flag 0x20
        const flipY = !((t[17]&0x20));
        const yy = flipY ? (mh-1-my) : my;
        const p = off + (yy*mw+mx)*bytespp;
        const b=t[p], gg=t[p+1], r=t[p+2];
        // sea tiles in RTW map_regions are black (0,0,0)
        return !(r===0&&gg===0&&b===0);
      }
      // map grid even-row tile (gx, cy) -> region-map pixel.
      // grid is 510 wide for a 1020-logical width => region map mw maps as
      // mx = round(gx / 510 * mw); my = round(cy / 700 * mh).
      let v1=0, v1land=0;
      for(let i=0;i<g.length;i++){
        if (g[i]!==1) continue;
        const gx=i%W, gy=Math.floor(i/W); const cy=Math.floor(gy/2);
        const mx=Math.min(mw-1, Math.round(gx/W*mw));
        const my=Math.min(mh-1, Math.round(cy/Hh*mh));
        v1++; if(isLand(mx,my)) v1land++;
      }
      console.log(`  v==1 cells: ${v1}  on land: ${v1land} (${(100*v1land/v1).toFixed(1)}%)`);
    }
  }
}

// (C) top cells (highest values) — where are the brightest spots?
console.log('\n=== (C) brightest cells (top values) ===');
{
  const arr=[];
  for(let i=0;i<g.length;i++) if(g[i]>=7) arr.push({gx:i%W, gy:Math.floor(i/W), v:g[i]});
  arr.sort((a,b)=>b.v-a.v);
  for(const a of arr.slice(0,20)){
    const cx=a.gx, cy=Math.floor(a.gy/2);
    let near=Infinity;
    for(const c of chars){const d=Math.abs(c.x-cx)+Math.abs(c.y-cy); if(d<near)near=d;}
    console.log(`  (gx=${a.gx},gy=${a.gy}) v=${a.v}  char-coord(${cx},${cy})  nearestCharManhattan=${near}`);
  }
}
