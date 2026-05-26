// dig-tilegap-counts-robust.js — robustly find GROUND_TILE block by scanning all template-record positions
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';

function isRec(buf,p){
  if(p+96>buf.length) return false;
  return buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200
    && buf.readUInt32LE(p+24)===2 && buf.readUInt32LE(p+68)===3 && buf[p+84]===64 && buf[p+85]===2;
}
// For a given stride, find the longest contiguous run of isRec
function longestRun(buf, stride){
  // find first isRec position by scanning (coarse then refine)
  let best={n:0,start:-1};
  // scan all byte positions where buf[p]==5 and buf[p+12]==10
  let p=0;
  while(p<buf.length-96){
    p=buf.indexOf(Buffer.from([5,0,0,0]), p);
    if(p<0) break;
    if(isRec(buf,p)){
      // count run
      let q=p, n=0;
      while(isRec(buf,q)){ n++; q+=stride; }
      if(n>best.n){ best={n,start:p}; }
      p=q; // skip past run
    } else p+=4;
  }
  return best;
}

const files = fs.readdirSync(DIR).filter(f=>f.endsWith('.sav'));
const rows=[];
for(const f of files){
  let buf; try{ buf=fs.readFileSync(DIR+f);}catch(e){continue;}
  let best={n:0,start:-1,stride:0};
  for(const stride of [115,267]){
    const r=longestRun(buf,stride);
    if(r.n>best.n) best={...r,stride};
  }
  rows.push([f, buf.length, best.stride, best.n, best.start]);
}
rows.sort((a,b)=>a[1]-b[1]);
console.log('size        stride  count     start       file');
for(const [f,sz,st,n,start] of rows){
  console.log(String(sz).padStart(10)+'  '+String(st).padStart(4)+'  '+String(n).padStart(7)+'  0x'+(start>=0?start.toString(16):'-').padStart(8)+'  '+f);
}
