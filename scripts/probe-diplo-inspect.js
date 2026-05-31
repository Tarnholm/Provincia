"use strict";
const fs=require("fs");const path=require("path");
function lo(p){const t=fs.readFileSync(p,"utf8");const o=[];let c=null;for(const l of t.split(/\r?\n/)){const fm=l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);if(fm){c=fm[1];continue;}if(c){const cm=l.match(/^\s*"culture":\s*"([a-z_]+)"/);if(cm){o.push(c);c=null;}}}return o;}
const buf=fs.readFileSync(process.argv[2]);
const readerBase=Number(process.argv[3]); const stride=Number(process.argv[4]||267);
const order=lo(path.join("C:\\RIS\\RIS\\data","descr_sm_factions.txt"));const N=order.length;
const cellStart=readerBase-8;
function cell(A,B){const o=cellStart+(A*N+B)*stride;return {p0:buf.readUInt32LE(o),key:buf.readUInt32LE(o+4),v8:buf.readUInt32LE(o+8),state:buf.readUInt32LE(o+12),v16:buf.readUInt32LE(o+16),bond:buf.readUInt32LE(o+20),agg:buf.readInt32LE(o+24)};}
for(const ab of [[0,0],[0,1],[0,5],[5,0],[0,2]]) console.log(`cell(${ab[0]},${ab[1]}) =`,JSON.stringify(cell(ab[0],ab[1])));
const hist={};let nn=0;
for(let A=0;A<N;A++)for(let B=0;B<N;B++){const o=cellStart+(A*N+B)*stride;if(o+20>buf.length)continue;const st=buf.readUInt32LE(o+12);if(st!==200){nn++;const v=buf.readUInt32LE(o+16);hist[v]=(hist[v]||0)+1;}}
console.log("non-neutral cells:",nn,"+16 distribution:",JSON.stringify(hist));
const v16all={};for(let A=0;A<N;A++)for(let B=0;B<N;B++){const o=cellStart+(A*N+B)*stride;if(o+20>buf.length)continue;const v=buf.readUInt32LE(o+16);v16all[v]=(v16all[v]||0)+1;}
console.log("+16 distribution (ALL cells):",JSON.stringify(v16all));
const stanceOf=(v)=>v===0?"allied":v>=600?"war":v>=400?"hostile":"neutral";
const wars=[],allies=[];
for(let B=0;B<N;B++){if(B===0)continue;const o=cellStart+(0*N+B)*stride;const st=buf.readUInt32LE(o+12);const s=stanceOf(st);if(s==="war")wars.push(order[B]);else if(s==="allied")allies.push(order[B]);}
console.log("romans_julii wars:",wars.length,wars.slice(0,15).join(","));
console.log("romans_julii allies:",allies.length,allies.slice(0,15).join(","));
