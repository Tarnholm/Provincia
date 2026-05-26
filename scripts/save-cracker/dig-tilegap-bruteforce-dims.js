// dig-tilegap-bruteforce-dims.js — for EVERY factor pair of 57120, test sea/land agreement vs map_regions
// A correct per-tile grid should make the canonical/non-canonical (or +28 value) align with sea vs land.
const fs = require('fs');
const {readTGA} = require('./dig-tilegap-tga.js');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAP = 'C:/RIS/RIS/data/world/maps/base/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

const buf = fs.readFileSync(DIR+'save_t0.sav');
const first = buf.indexOf(MAGIC);
const STRIDE=267;
let start=first; function isRec(p){ return buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200 && buf.readUInt32LE(p+24)===2 && buf.readUInt32LE(p+68)===3 && buf[p+84]===64 && buf[p+85]===2; }
while(start-STRIDE>=0 && isRec(start-STRIDE)) start-=STRIDE;
let end=start; while(isRec(end)) end+=STRIDE;
const N=(end-start)/STRIDE;

// Per-cell signal: combine the 3 varying fields into a category
// We'll just test "is canonical" (200/6/200) vs "non-canonical" as a binary against sea/land
const sig = new Uint8Array(N);
let ncCount=0;
for(let i=0;i<N;i++){
  const b=start+i*STRIDE;
  const canon=(buf.readUInt32LE(b+20)===200 && buf.readUInt32LE(b+28)===6 && buf.readUInt32LE(b+32)===200);
  sig[i]=canon?0:1; if(!canon) ncCount++;
}
console.log(`N=${N}, non-canonical=${ncCount} (${(100*ncCount/N).toFixed(2)}%)`);

const tR = readTGA(MAP+'map_regions.tga');
// Sea in map_regions = r=41, g=140 (blue channel is a gradient ~232..252)
function isSea(x,y){ const c=tR.get(x,y); return c.r===41&&c.g===140; }

// factor pairs
const pairs=[]; for(let w=2;w<=N;w++){ if(N%w===0){ const h=N/w; if(w<=2100&&h<=2100) pairs.push([w,h]); } }
// For each pair + each flip, measure mutual agreement: best of (nc=>sea) and (nc=>land)
let best={score:0};
for(const [W,H] of pairs){
  for(const yflip of [0,1]){
    let seaTotal=0, ncSea=0, cSea=0;
    for(let i=0;i<N;i++){
      let gy=(i/W)|0, gx=i%W; if(yflip) gy=H-1-gy;
      const tx=Math.floor((gx+0.5)/W*tR.w), ty=Math.floor((gy+0.5)/H*tR.h);
      const sea=isSea(tx,ty)?1:0; seaTotal+=sea;
      if(sig[i]) ncSea+=sea; else cSea+=sea;
    }
    const seaFrac=seaTotal/N;
    // If signal tracked sea: P(sea|nc) should be very different from baseline seaFrac
    const pSeaGivenNC = ncCount? ncSea/ncCount : 0;
    const lift = Math.abs(pSeaGivenNC - seaFrac);
    if(lift>best.score) best={score:lift, W,H,yflip, pSeaGivenNC, seaFrac};
  }
}
console.log('baseline sea fraction (map) ~', (best.seaFrac*100).toFixed(1)+'%');
console.log(`BEST dimensional alignment: ${best.W}x${best.H} yflip=${best.yflip}  P(sea|nonCanon)=${(best.pSeaGivenNC*100).toFixed(1)}% vs baseline ${(best.seaFrac*100).toFixed(1)}%  lift=${(best.score*100).toFixed(1)}pp`);
console.log('(A real per-tile sea/land signal would give lift near 50-99pp. Near 0 = no spatial relationship.)');
