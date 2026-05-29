// Test a CRIB-FREE aligner: state field (+12) is symmetric and non-neutral
// cells are sparse, so the true alignment maximizes symmetry AMONG non-neutral
// cells (state(r,c)==state(c,r) where either side != 200). Wrong offsets scramble
// the (r,c)<->(c,r) pairing. If this picks the same base as the state crib, we
// can drop the descr_strat dependency for locating the matrix.
"use strict";
const fs = require("fs");
const STRIDE = 267, N = 239;
function roughAnchor(buf){ const lc=(o)=>o>=0&&o+20<=buf.length&&buf.readUInt32LE(o+8)===200&&buf.readUInt32LE(o+16)===2&&buf.readUInt32LE(o)===0;
  for(let p=0x4000;p<Math.min(buf.length-STRIDE*4,0x800000);p++){ if(!lc(p))continue; let s=p; while(lc(s-STRIDE))s-=STRIDE; return s; } return null; }

function alignBySymmetry(buf, rough){
  const st=(base,r,c)=>{const o=base+(r*N+c)*STRIDE+12; return (o>=0&&o+4<=buf.length)?buf.readInt32LE(o):null;};
  let best={frac:-1};
  for(let k=-40;k<=40;k++){ const base=rough+k*STRIDE;
    let sym=0,tot=0;
    // sample pairs r<c across the grid
    for(let r=0;r<N;r++)for(let c=r+1;c<N;c++){ const a=st(base,r,c),b=st(base,c,r); if(a==null||b==null)continue;
      if(a!==200||b!==200){ tot++; if(a===b)sym++; } }
    const frac=tot?sym/tot:0;
    if(frac>best.frac||(frac===best.frac&&Math.abs(k)<Math.abs(best.k))) best={frac,k,base,tot};
  }
  return best;
}

for(const p of process.argv.slice(2)){
  const buf=fs.readFileSync(p); const rough=roughAnchor(buf);
  const b=alignBySymmetry(buf,rough);
  // count states at chosen base
  const st=(r,c)=>buf.readInt32LE(b.base+(r*N+c)*STRIDE+12);
  let wars=0,allies=0; for(let r=0;r<N;r++)for(let c=r+1;c<N;c++){const v=st(r,c); if(v===600)wars++; else if(v===0)allies++;}
  console.log(`${p.split(/[\\/]/).pop().padEnd(22)} base=0x${b.base.toString(16)} k=${b.k} sym=${(b.frac*100).toFixed(1)}% (n=${b.tot}) -> ${wars} wars, ${allies} allies`);
}
