// dig-tilegap-crosscampaign.js — is the GROUND_TILE block identical across different campaigns on the SAME map?
const fs = require('fs');
const DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/';
const MAGIC = Buffer.from([0x05,0,0,0, 0,0,0,0, 0,0,0,0, 0x0a,0,0,0, 0xc8,0,0,0]);
function isRec(buf,p){ return buf.readUInt32LE(p)===5 && buf.readUInt32LE(p+12)===10 && buf.readUInt32LE(p+16)===200
  && buf.readUInt32LE(p+24)===2 && buf.readUInt32LE(p+68)===3 && buf[p+84]===64 && buf[p+85]===2; }
function block(f){
  const buf=fs.readFileSync(DIR+f);
  const anchor=buf.indexOf(MAGIC);
  let start=anchor; while(start-267>=0 && isRec(buf,start-267)) start-=267;
  let end=anchor; while(end+267<=buf.length && isRec(buf,end)) end+=267;
  return {buf,start,end,N:(end-start)/267};
}
const STRIDE=267;
function compare(fa,fb){
  const A=block(fa), B=block(fb);
  console.log(`\n=== ${fa} (N=${A.N}) vs ${fb} (N=${B.N}) ===`);
  const n=Math.min(A.N,B.N);
  let cellDiff=0; const byteDiff=new Array(STRIDE).fill(0); const diffCells=[];
  for(let i=0;i<n;i++){
    let d=false;
    for(let j=0;j<STRIDE;j++){ if(A.buf[A.start+i*STRIDE+j]!==B.buf[B.start+i*STRIDE+j]){ byteDiff[j]++; d=true; } }
    if(d){ cellDiff++; if(diffCells.length<10) diffCells.push(i); }
  }
  console.log(`  cells differing: ${cellDiff}/${n} (${(100*cellDiff/n).toFixed(2)}%)`);
  const dp=byteDiff.map((c,j)=>[j,c]).filter(x=>x[1]>0);
  console.log(`  differing byte offsets: ${dp.map(x=>`+${x[0]}(${x[1]})`).join(' ')||'NONE'}`);
  console.log(`  example diff cells: ${diffCells.join(',')}`);
}
// same campaign, same turn (sanity: should be 0)
compare('save_t0.sav','save_t0justbeforeturnend.sav');
// different campaigns, same map, all turn 0/1
compare('save_t0.sav','save_macedon t0.sav');
compare('save_macedon t0.sav','save_Seleucids t0.sav');
compare('save_t0.sav','save_Autosave   Carthage   Turn 1 End.sav');
