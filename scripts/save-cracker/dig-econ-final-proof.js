// dig-econ-final-proof.js
// Rigorous final test on the 8-turn Republic-of-Rome trajectory (marker-tracked):
//  1) Confirm NO block field reproduces net income (treasury delta) exactly.
//  2) Confirm treasury net = treasury(+0) delta only (not stored).
//  3) Characterise f13 precisely: f13(turn N) vs treasury(N), treasury(N-1),
//     and f13 inter-turn deltas. Decide if it is a usable money timeline.
//  4) Test f1/f3/f9/f11 as cumulative income components (their deltas vs treasury delta).
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = ["save_t0.sav","save_t1.sav","save_t2.sav","save_t3.sav","save_t4.sav","save_t5.sav","save_t6.sav","save_t7.sav"];
const MARKER = -315582356;

function ordinal0(buf, core){for(let off=core-4;off>=core-60000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function parseBlock(buf, core){const start=ordinal0(buf,core);if(start<0)return null;const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const marker=f[f.length-1];const body=f.slice(2,f.length-1);const S=23;if(body.length%S)return {marker,bad:true};const bl=[];for(let b=0;b<body.length/S;b++)bl.push(body.slice(b*S,(b+1)*S));return {marker,blocks:bl};}
function byMarker(buf){const recs=parseFactionTreasuries(buf);for(const r of recs){const pb=parseBlock(buf,r.offset);if(pb&&!pb.bad&&pb.marker===MARKER)return {pr:r,pb};}return null;}

const T=[];
for(const f of FILES){const p=path.join(BASE,f);if(!fs.existsSync(p))continue;const buf=fs.readFileSync(p);const h=byMarker(buf);if(!h)continue;T.push({treasury:h.pr.treasury,turnStart:h.pr.turnStartTreasury,blocks:h.pb.blocks});}

const treasury=T.map(t=>t.treasury);
const netD=treasury.slice(1).map((v,i)=>v-treasury[i]);
console.log("treasury :", treasury.join(" "));
console.log("net delta:  -- ", netD.join(" "));

// 1) Does any field's per-turn delta == net delta across all turns?
// Use the CURRENT (last) block of each save as that save's snapshot.
const F=23;
console.log("\n=== test: field-delta (last block, save N -> N+1) == net delta? ===");
let any=false;
for(let f=0;f<F;f++){
  const series=T.map(t=>t.blocks[t.blocks.length-1][f]);
  const d=series.slice(1).map((v,i)=>v-series[i]);
  const eq=d.every((v,i)=>v===netD[i]);
  if(eq){console.log(`  f${f} delta == net delta!  series=${series.join(",")}`);any=true;}
}
if(!any) console.log("  -> NO field delta reproduces net income (confirms net = treasury delta only, not stored).");

// 2) Does any field absolute == treasury across all turns?
console.log("\n=== test: field (last block) == treasury(+0)? ===");
let any2=false;
for(let f=0;f<F;f++){
  const series=T.map(t=>t.blocks[t.blocks.length-1][f]);
  if(series.every((v,i)=>v===treasury[i])){console.log(`  f${f} == treasury`);any2=true;}
}
if(!any2) console.log("  -> NO block field equals treasury; treasury lives ONLY at record +0 / +180.");

// 3) f13 characterisation: finalized f13(turn N) = block[N-1].f13 in save N (or later).
//    Take from the LAST save (t7) which has all turns finalized: blocks 0..6 finalized.
const allBlocks=T[T.length-1].blocks; // 8 blocks; 0..6 finalized, 7 current
const f13=allBlocks.map(b=>b[13]);
console.log("\n=== f13 timeline (from t7 save, blocks 0..7) ===");
console.log("  f13      :", f13.join(" "));
console.log("  treasury :", treasury.join(" "));
console.log("  f13(N) - treasury(N)   :", f13.map((v,i)=>i<treasury.length?v-treasury[i]:"-").join(" "));
console.log("  f13(N) - treasury(N+1) :", f13.map((v,i)=>i+1<treasury.length?v-treasury[i+1]:"-").join(" "));
console.log("  f13 deltas             :", f13.slice(1).map((v,i)=>v-f13[i]).join(" "));

// 4) cumulative income test: f1/f3/f9/f11 deltas vs net delta sign/magnitude.
console.log("\n=== f1/f3/f9/f11 (last block) deltas vs net delta ===");
for(const f of [1,3,9,11]){
  const series=T.map(t=>t.blocks[t.blocks.length-1][f]);
  const d=series.slice(1).map((v,i)=>v-series[i]);
  console.log(`  f${f}: ${series.join(",")}  Δ=${d.join(",")}`);
}
console.log(`  net Δ for reference: ${netD.join(",")}`);
