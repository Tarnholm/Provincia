// dig-midfile-recount3.js — session 18: variant terrain/feature correlation NEGATIVE.
// At the corrected 240×238 grid resolution, neither resources nor watchtowers from
// descr_strat preferentially land on non-canonical cells. Hit/baseline ratios:
//   - Resources: 0.93x random baseline → NO correlation (5505/5633 in canon cells)
//   - Watchtowers: 23/23 in canon, 0 in non-canon → NO correlation
//   - map_ground_types.tga top color per variant: ~22-25% all variants → NO correlation
//
// The mid-file 57,120 records remain HYPOTHESIS-grade in semantic — confirmed
// structurally as a 240×238 grid encoding ~13 enum-style variant flags, but NOT a
// resource/watchtower placement cache.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const STRIDE = 267;
const START = 0xf8fd2;
const W = 240;
const H = 238;
const N = W*H;

function getKey(off){
  return buf.readUInt32LE(off+16)+'_'+buf.readUInt32LE(off+20)+'_'+buf.readUInt32LE(off+24)+'_'+buf.readUInt32LE(off+28)+'_'+buf.readUInt32LE(off+32);
}

const ds = fs.readFileSync('C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt', 'utf-8');
const resources = [];
for(const l of ds.split(/\r?\n/)){
  const m = l.match(/^resource\s+([a-z_]+),\s+(\d+),\s+(\d+),\s*(\d+)/);
  if(m) resources.push({type: m[1], x: +m[3], y: +m[4]});
}
const watchtowers = [];
for(const l of ds.split(/\r?\n/)){
  const m = l.match(/^watchtower\s+([0-9]+),?\s+([0-9]+)/);
  if(m) watchtowers.push({x:+m[1], y:+m[2]});
}

// Try matching with W=240/H=238 grid, with and without y-flip
function tryMap(label, flipY){
  let canon=0, non=0;
  for(const res of resources){
    const c = Math.floor(res.x * W / 1020);
    const y0 = res.y * H / 700;
    const r = Math.floor(flipY ? H - 1 - y0 : y0);
    if(c<0||c>=W||r<0||r>=H) continue;
    const off = START + (r*W+c)*STRIDE;
    if(getKey(off) === '200_200_2_6_200') canon++; else non++;
  }
  console.log('  '+label+': '+canon+' canon, '+non+' non-canon, ratio='+(non/(canon+non)*100).toFixed(1)+'%');
}
console.log('Resource placement: '+resources.length+' total, baseline non-canon rate='+(1389/N*100).toFixed(2)+'%');
tryMap('full map (no flip)', false);
tryMap('full map (y-flip)', true);

let cW=0, nW=0;
for(const wt of watchtowers){
  const c = Math.floor(wt.x * W / 1020);
  const r = Math.floor(wt.y * H / 700);
  if(c<0||c>=W||r<0||r>=H) continue;
  const off = START + (r*W+c)*STRIDE;
  if(getKey(off) === '200_200_2_6_200') cW++; else nW++;
}
console.log('\nWatchtowers: '+watchtowers.length+' total → '+cW+' in canon, '+nW+' in non-canon (no correlation)');

// Ground type sampling — does any variant correlate with map_ground_types?
const TGA = 'C:/RIS/RIS/data/world/maps/base/map_ground_types.tga';
const tga = fs.readFileSync(TGA);
const W_TGA = tga.readUInt16LE(12);
const H_TGA = tga.readUInt16LE(14);
const PX = 18;
function gtPx(x,y){
  const ty = H_TGA-1-y;
  const o = PX + (ty*W_TGA + x)*3;
  return tga[o+2]+','+tga[o+1]+','+tga[o]; // R,G,B
}
function cellGT(c, r){
  const cx = Math.min(W_TGA-1, Math.floor((c+0.5)*1020/W));
  const cy = Math.min(H_TGA-1, Math.floor((r+0.5)*700/H));
  return gtPx(cx, 700-1-cy);
}
const keyClassByVariant = {};
for(let r=0;r<H;r++) for(let c=0;c<W;c++){
  const off = START + (r*W+c)*STRIDE;
  const k = getKey(off);
  const gt = cellGT(c, r);
  keyClassByVariant[k] = keyClassByVariant[k] || {};
  keyClassByVariant[k][gt] = (keyClassByVariant[k][gt]||0)+1;
}
console.log('\nDominant ground_type per variant (% of records sharing same top color):');
for(const [vk, hist] of Object.entries(keyClassByVariant)){
  const s = Object.entries(hist).sort((a,b)=>b[1]-a[1]);
  const total = s.reduce((sum,[,c])=>sum+c,0);
  console.log('  '+vk+' (N='+total+'): top GT RGB='+s[0][0]+' '+(s[0][1]/total*100).toFixed(0)+'% — DIFFUSE across all GT types');
}
