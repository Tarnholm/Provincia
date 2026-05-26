// dig-tilegap-variation-map.js — where do the ~2.7% non-canonical cells sit? cluster or geometric?
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

const buf = fs.readFileSync(DIR+'save_t0.sav');
const first = buf.indexOf(MAGIC);
const STRIDE=267, W=240, H=238, N=W*H;

// canonical = +20==200 && +28==6 && +32==200
let nonCanon=0;
const grid=[];
for(let y=0;y<H;y++) grid.push('');
for(let i=0;i<N;i++){
  const b=first+i*STRIDE;
  const v20=buf.readUInt32LE(b+20), v28=buf.readUInt32LE(b+28), v32=buf.readUInt32LE(b+32);
  const canon = (v20===200 && v28===6 && v32===200);
  let c='.';
  if(!canon){
    nonCanon++;
    if(v28===54) c='B';        // boundary marker
    else if(v28===55) c='b';
    else if(v20===600||v32===600) c='H';  // high
    else if(v20===0||v32===0) c='0';
    else if(v32>4000000000) c='N'; // negative
    else c='?';
  }
  const gy=(i/W)|0, gx=i%W;
  grid[gy]+=c;
}
console.log(`non-canonical cells: ${nonCanon}/${N} (${(100*nonCanon/N).toFixed(2)}%)`);
console.log('grid (every 4th col, every 4th row):');
for(let y=0;y<H;y+=4){
  let row=String(y).padStart(3)+' ';
  for(let x=0;x<W;x+=4) row+=grid[y][x];
  console.log(row);
}
