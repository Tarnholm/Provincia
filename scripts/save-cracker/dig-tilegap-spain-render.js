// dig-tilegap-spain-render.js — render Spain GROUND_TILE field grid AND show tuple distribution
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);
const buf = fs.readFileSync(DIR+'save_17-05-2026   Spain   Turn 1.sav');
const STRIDE=115;
const anchor=buf.indexOf(MAGIC);
function isRec(p){ return buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200 && buf.readUInt32LE(p+24)===2 && buf.readUInt32LE(p+68)===3 && buf[p+84]===64 && buf[p+85]===2; }
let start=anchor; while(start-STRIDE>=0 && isRec(start-STRIDE)) start-=STRIDE;
let end=anchor; while(isRec(end)) end+=STRIDE;
const N=(end-start)/STRIDE;
console.log('Spain N=',N,'block 0x'+start.toString(16)+'..0x'+end.toString(16));

// tuple distribution
const tup={};
for(let i=0;i<N;i++){ const b=start+i*STRIDE; const k=`${buf.readUInt32LE(b+20)}/${buf.readUInt32LE(b+28)}/${buf.readInt32LE(b+32)}`; tup[k]=(tup[k]||0)+1; }
console.log('(+20/+28/+32) tuple counts:', JSON.stringify(Object.entries(tup).sort((a,b)=>b[1]-a[1])));

function render(W){
  const H=N/W; if(!Number.isInteger(H)) return;
  console.log(`\n--- ${W}x${H} : +28 field (.=6 #=54 d=other) ---`);
  for(let y=0;y<H;y++){ let r=''; for(let x=0;x<W;x++){ const v=buf.readUInt32LE(start+(y*W+x)*STRIDE+28); r+= v===6?'.':v===54?'#':v===55?'5':'?'; } console.log(r); }
  console.log(`--- ${W}x${H} : +20 field (.=200 H=600 0=0) ---`);
  for(let y=0;y<H;y++){ let r=''; for(let x=0;x<W;x++){ const v=buf.readUInt32LE(start+(y*W+x)*STRIDE+20); r+= v===200?'.':v===600?'H':v===0?'0':'?'; } console.log(r); }
}
render(22);
render(20);
