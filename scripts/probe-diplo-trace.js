// Trace the production locator's behaviour around the KNOWN real matrix on
// Raymond T5 (readerBase=1093591 => cellStart=1093583, first sig cell=cell(0,1)).
"use strict";
const fs=require("fs");const path=require("path");
function lo(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const buf=fs.readFileSync(process.argv[2]);
const N=lo(path.join("C:\\RIS\\RIS\\data","descr_sm_factions.txt")).length;
const cellStart=1093583; const stride=267;
const sig=(o)=> o>=0 && o+20<=buf.length && buf.readUInt32LE(o)===0 && buf.readUInt32LE(o+8)===200 && buf.readUInt32LE(o+16)===2;
const stateAt=(base,s,r,c)=>{const o=base+(r*N+c)*s+12;return (o>=0&&o+4<=buf.length)?buf.readInt32LE(o):null;};
// where does sig first pass at/after cellStart?
let firstSig=-1; for(let p=cellStart;p<cellStart+stride*3;p++){if(sig(p)){firstSig=p;break;}}
console.log("cellStart sig?",sig(cellStart),"cell(0,1) at",cellStart+stride,"sig?",sig(cellStart+stride));
console.log("first sig at/after cellStart:",firstSig,"(=cellStart+",firstSig-cellStart,")");
// run length of sig cells at stride 267 starting from cell(0,1):
const start=cellStart+stride;
let run=0; for(let k=0;k<N;k++){if(sig(start+k*stride))run++;else break;}
console.log("sig run from cell(0,1) at stride267:",run,"/ N=",N);
// list which k in 0..N-1 FAIL sig (the diagonal cells (k,k) won't pass)
const fails=[];for(let k=0;k<N;k++){if(!sig(start+k*stride))fails.push(k);}
console.log("cells in row failing sig (first 20):",fails.slice(0,20),"total fails:",fails.length);
// walk-back from firstSig
let rough=firstSig; while(sig(rough-stride))rough-=stride;
console.log("walk-back rough:",rough,"(cellStart is",cellStart,"diff",rough-cellStart,")");
// sweep symmetry around rough
let best={frac:-1,k:0,base:rough,tot:0};
for(let k=-40;k<=40;k++){const base=rough+k*stride;let sym=0,tot=0;for(let r=0;r<N;r++)for(let c=r+1;c<N;c++){const a=stateAt(base,stride,r,c),b=stateAt(base,stride,c,r);if(a==null||b==null)continue;if(a!==200||b!==200){tot++;if(a===b)sym++;}}const frac=tot?sym/tot:0;if(frac>best.frac)best={frac,k,base,tot};}
console.log("best sweep from this rough: frac=",best.frac.toFixed(4),"k=",best.k,"base+8=",best.base+8,"pairs=",best.tot);
