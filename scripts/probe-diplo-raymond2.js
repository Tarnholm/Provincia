// Raymond T5 deep hunt: does an NxN symmetric state matrix exist at ANY stride
// with cells whose +12 field is in {0,200,400,600,850,1000}? Drop the 200/2 sig;
// anchor purely on "a long run of cells where +12 ∈ stance-set and +8==200".
"use strict";
const fs = require("fs");
const path = require("path");
function loadFactionOrder(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const save=process.argv[2];const mod=process.argv[3]||"C:\\RIS\\RIS\\data";
const buf=fs.readFileSync(save);const order=loadFactionOrder(path.join(mod,"descr_sm_factions.txt"));const N=order.length;
console.log(`save=${path.basename(save)} N=${N}`);

// Check the faction-record layout to confirm Republic of Rome (sub=8).
const ext=require("../src/saveCrackerExtras.js");
const recs=ext.parseFactionTreasuries(buf);
console.log(`faction records=${recs.length} player(rec0 fid=${recs[0]&&recs[0].factionId})`);
// Republic of Rome sub=8 => one record per faction incl player, factionId=position.

// Hunt: a real diplomacy cell has +8==200 (the neutral baseline constant) and
// +12 (state) in the stance set. Find offsets where MANY consecutive stride-s
// cells satisfy this, for s in 80..400. Report sparse-symmetric candidates.
const STANCES = new Set([0,200,400,600,850,1000]);
const cellOK=(o)=> o>=0 && o+16<=buf.length && buf.readUInt32LE(o+8)===200 && STANCES.has(buf.readUInt32LE(o+12)>>>0);
const stateAt=(base,stride,r,c)=>{const o=base+(r*N+c)*stride+12; return (o>=0&&o+4<=buf.length)?buf.readInt32LE(o):null;};

// Collect positions where +8==200 and +12 in stance set (looser than strict sig).
const t0=Date.now();
const pos=[];
for(let p=0x4000;p+16<=buf.length;p++){ if(cellOK(p)) pos.push(p); }
const posSet=new Set(pos);
console.log(`looser cellOK positions(4-aligned)=${pos.length} ${Date.now()-t0}ms`);

// For a range of strides, find any p with an N-run; sweep symmetry; keep sparse.
const results=[];
const tried=new Set();
let evals=0;
for(const p of pos){
  for(let s=80;s<=400;s++){
    if(!posSet.has(p+s)) continue;
    // quick run check (allow 4-alignment): require run>=N with this stride
    let run=0; for(let k=0;k<N;k++){ if(posSet.has(p+k*s)) run++; else break; }
    if(run<N) continue;
    let rough=p; while(posSet.has(rough-s)) rough-=s;
    const tag=rough+":"+s; if(tried.has(tag)) continue; tried.add(tag);
    let best={frac:-1,base:rough,k:0,tot:1e9};
    for(let k=-20;k<=20;k++){
      const base=rough+k*s; let sym=0,tot=0;
      for(let r=0;r<N;r++)for(let cc=r+1;cc<N;cc++){const a=stateAt(base,s,r,cc),b=stateAt(base,s,cc,r);if(a==null||b==null)continue;if(a!==200||b!==200){tot++;if(a===b)sym++;}}
      evals++;
      const frac=tot?sym/tot:0;
      if(frac>best.frac||(frac===best.frac&&tot<best.tot)) best={frac,base,k,tot};
    }
    results.push({rough,stride:s,base:best.base+8,k:best.k,frac:best.frac,tot:best.tot});
    break; // one stride per p
  }
}
console.log(`tried roughs=${tried.size} sweeps=${evals} ${Date.now()-t0}ms`);
results.sort((a,b)=>b.frac-a.frac||a.tot-b.tot);
console.log(`SPARSE-symmetric candidates (frac>=0.9, pairs<${N*3}): ${results.length}`);
for(const r of results.slice(0,15)) console.log(`  base=${r.base} stride=${r.stride} k=${r.k} frac=${r.frac.toFixed(4)} pairs=${r.tot}`);
