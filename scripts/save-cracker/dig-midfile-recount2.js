// dig-midfile-recount2.js — session 18: variant counts and grid alignment for the
// corrected 57,120-record mid-file array. Confirms 240×238 grid (53,520+ canonical
// + 1,389 non-canonical, with strong row 237 / col 239 edge stripe = bottom row +
// rightmost col of the grid). Maps grid coords to map_regions.tga (1020×700) and
// tests resource/watchtower coordinate correlation.

const fs = require('fs');
const buf = fs.readFileSync('C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav');
const STRIDE = 267;
const START = 0xf8fd2;  // corrected from session 15
const W = 240;
const H = 238;
const N = W*H;  // 57120

function getKey(off){
  return buf.readUInt32LE(off+16)+'_'+buf.readUInt32LE(off+20)+'_'+buf.readUInt32LE(off+24)+'_'+buf.readUInt32LE(off+28)+'_'+buf.readUInt32LE(off+32);
}

// Variant histogram
const counts = {};
for(let n=0;n<N;n++){
  counts[getKey(START + n*STRIDE)] = (counts[getKey(START + n*STRIDE)]||0)+1;
}
const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
console.log('TOTAL: '+N+' records ('+sorted.length+' distinct variant keys)');
for(const [k,c] of sorted) console.log('  '+k+': '+c+(c===55731?' ← canonical':''));

// Edge analysis at W=240, H=238
const cols = new Array(W).fill(0);
const rows = new Array(H).fill(0);
let nonCanon = 0;
for(let r=0;r<H;r++) for(let c=0;c<W;c++){
  const k = getKey(START + (r*W+c)*STRIDE);
  if(k !== '200_200_2_6_200'){
    cols[c]++;
    rows[r]++;
    nonCanon++;
  }
}
console.log('\nNon-canonical: '+nonCanon);
console.log('Column 239 (rightmost): '+cols[239]+' non-canonical (out of '+H+' rows) ← edge marker');
console.log('Row 237 (bottom):       '+rows[237]+' non-canonical (out of '+W+' cols) ← edge marker');
console.log('Empty cols:', cols.filter(x=>x===0).length, ' Empty rows:', rows.filter(x=>x===0).length);

// Resource correlation test
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
console.log('\nResources: '+resources.length+', watchtowers: '+watchtowers.length);
let rHit=0, rMiss=0;
for(const res of resources){
  const c = Math.floor(res.x * W / 1020);
  const r = Math.floor(res.y * H / 700);
  if(c<0||c>=W||r<0||r>=H) continue;
  const off = START + (r*W+c)*STRIDE;
  if(getKey(off) === '200_200_2_6_200') rMiss++; else rHit++;
}
console.log('Resources in canon: '+rMiss+', in non-canon: '+rHit+' (random baseline expected: '+(resources.length*nonCanon/N).toFixed(0)+')');
console.log('Hit/baseline ratio: '+(rHit/(resources.length*nonCanon/N)).toFixed(2)+' → NOT preferentially aligned with resources');

let wHit=0, wMiss=0;
for(const wt of watchtowers){
  const c = Math.floor(wt.x * W / 1020);
  const r = Math.floor(wt.y * H / 700);
  if(c<0||c>=W||r<0||r>=H) continue;
  const off = START + (r*W+c)*STRIDE;
  if(getKey(off) === '200_200_2_6_200') wMiss++; else wHit++;
}
console.log('Watchtowers in canon: '+wMiss+', in non-canon: '+wHit+' / '+watchtowers.length);
