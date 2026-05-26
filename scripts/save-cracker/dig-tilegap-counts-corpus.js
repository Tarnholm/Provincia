// dig-tilegap-counts-corpus.js — GROUND_TILE record count across many saves of varying size/turn
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);

function isRec(buf,p){ return buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200
  && buf.readUInt32LE(p+24)===2 && buf.readUInt32LE(p+68)===3 && buf[p+84]===64 && buf[p+85]===2; }

// auto-detect stride from first two anchor occurrences
function strideOf(buf){ const a=buf.indexOf(MAGIC); const b=buf.indexOf(MAGIC,a+4); return b-a; }

const files = fs.readdirSync(DIR).filter(f=>f.endsWith('.sav'));
const rows=[];
for(const f of files){
  let buf; try{ buf=fs.readFileSync(DIR+f);}catch(e){continue;}
  const anchor=buf.indexOf(MAGIC); if(anchor<0){ rows.push([f, buf.length, '-', '?']); continue; }
  const stride=strideOf(buf);
  let start=anchor; while(start-stride>=0 && isRec(buf,start-stride)) start-=stride;
  let end=anchor; while(end+stride<=buf.length && isRec(buf,end)) end+=stride;
  const N=(end-start)/stride;
  rows.push([f, buf.length, stride, N]);
}
rows.sort((a,b)=>a[1]-b[1]);
console.log('file_size_bytes  stride  GROUND_TILE_count   filename');
for(const [f,sz,st,n] of rows){
  console.log(String(sz).padStart(10)+'   '+String(st).padStart(4)+'   '+String(n).padStart(8)+'   '+f);
}
