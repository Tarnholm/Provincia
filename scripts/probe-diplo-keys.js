"use strict";
const fs=require("fs");const path=require("path");
function lo(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const buf=fs.readFileSync(process.argv[2]);
const readerBase=Number(process.argv[3]);const stride=Number(process.argv[4]||267);
const order=lo(path.join("C:\\RIS\\RIS\\data","descr_sm_factions.txt"));const N=order.length;
const cellStart=readerBase-8;
// key distribution over ALL cells, and over row 0
const keyHist={};const p0Hist={};const v8Hist={};
for(let A=0;A<N;A++)for(let B=0;B<N;B++){const o=cellStart+(A*N+B)*stride;if(o+20>buf.length)continue;const key=buf.readUInt32LE(o+4);keyHist[key]=(keyHist[key]||0)+1;const p0=buf.readUInt32LE(o);p0Hist[p0]=(p0Hist[p0]||0)+1;const v8=buf.readUInt32LE(o+8);v8Hist[v8]=(v8Hist[v8]||0)+1;}
const topKeys=Object.entries(keyHist).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log("key distribution (top10):",JSON.stringify(topKeys));
console.log("distinct keys:",Object.keys(keyHist).length);
console.log("+0 distribution:",JSON.stringify(Object.entries(p0Hist).sort((a,b)=>b[1]-a[1]).slice(0,5)));
console.log("+8 distribution:",JSON.stringify(Object.entries(v8Hist).sort((a,b)=>b[1]-a[1]).slice(0,5)));
// row 0 keys
let r0=[];for(let B=0;B<Math.min(N,30);B++){const o=cellStart+(0*N+B)*stride;r0.push(buf.readUInt32LE(o+4));}
console.log("row0 keys[0..30]:",r0.join(","));
// how many cells satisfy strict sig (+0==0 && +8==200 && +16==2)
let strict=0;for(let A=0;A<N;A++)for(let B=0;B<N;B++){const o=cellStart+(A*N+B)*stride;if(o+20>buf.length)continue;if(buf.readUInt32LE(o)===0&&buf.readUInt32LE(o+8)===200&&buf.readUInt32LE(o+16)===2)strict++;}
console.log(`cells passing STRICT sig (+0==0,+8==200,+16==2): ${strict}/${N*N}`);
