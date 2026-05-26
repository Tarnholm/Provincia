// dig-econ-f13-decompose.js
// f13 (per COMPLETED block) is a non-zero, per-faction, increasing income-like
// value. Decode the 23-field block fully and test whether f13 is a SUM of other
// fields, or equals income (gross) / net. Use the player's T4 (4 complete history
// blocks) plus AI factions for variety. Also test the relationship to treasury
// trajectory accounting for spend (retrains happened, so net != gross).
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const turns = ["T1","T2","T3","T4"];

function ordinal0(buf, core){for(let off=core-4;off>=core-20000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function blocksFor(buf, core){const start=ordinal0(buf,core);const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const body=f.slice(2,f.length-1);const S=23,n=body.length/S;const bl=[];for(let b=0;b<n;b++)bl.push(body.slice(b*S,(b+1)*S));return bl;}

// Use T4 player: 4 blocks, blocks 0..2 complete, block3 current.
const bufT4 = fs.readFileSync(path.join(BASE, FILES.T4));
const prT4 = parseFactionTreasuries(bufT4).find(r=>r.factionId===5 && r.treasury===GROUND.T4);
const pb = blocksFor(bufT4, prT4.offset);

console.log("=== T4 player full blocks (23 fields each) ===");
pb.forEach((b,i)=>console.log(`  blk${i}: ${b.map((v,f)=>`${f}:${v}`).join("  ")}`));

console.log("\n=== per-block: is f13 a sum of any subset of non-zero fields? ===");
pb.forEach((b,i)=>{
  if (b[13]===0){ console.log(`  blk${i}: f13=0 (current turn, skip)`); return; }
  // candidate income components: f1,f3,f5,f8,f9,f11 etc. Print and test sums.
  const comps = {f1:b[1],f3:b[3],f5:b[5],f8:b[8],f9:b[9],f11:b[11]};
  const f13=b[13];
  console.log(`  blk${i}: f13=${f13}  comps=${JSON.stringify(comps)}`);
  // brute: subset of {f0..f22 except f13} summing to f13
  const idx=[]; for(let k=0;k<23;k++) if(k!==13 && b[k]!==0) idx.push(k);
  // try all pairs/triples
  for(let a=0;a<idx.length;a++)for(let bb=a;bb<idx.length;bb++){
    if (b[idx[a]]+b[idx[bb]]===f13) console.log(`     f${idx[a]}+f${idx[bb]}=${f13}`);
    for(let c=bb;c<idx.length;c++) if(b[idx[a]]+b[idx[bb]]+b[idx[c]]===f13) console.log(`     f${idx[a]}+f${idx[bb]}+f${idx[c]}=${f13}`);
  }
});

// Cross-faction: gather (treasury this turn, treasury prev turn, f13 of the
// completed block for that transition) to test f13 vs net & vs gross.
console.log("\n=== cross-faction: completed-block f13 vs treasury delta ===");
const bufs={}, recs={};
for(const t of turns){bufs[t]=fs.readFileSync(path.join(BASE,FILES[t]));recs[t]=parseFactionTreasuries(bufs[t]);}
const fids=[1,5,6,7,8,9];
for(const fid of fids){
  // map turn->record (match by factionId; treasury may go negative so don't filter on GROUND)
  const r={};
  for(const t of turns){ r[t]=recs[t].filter(x=>x.factionId===fid); }
  // pick the one that is the same record across turns: use the first
  const pr={}; let ok=true;
  for(const t of turns){ if(!r[t][0]){ok=false;break;} pr[t]=r[t][0]; }
  if(!ok){ console.log(`  fid=${fid}: missing`); continue; }
  const tre=turns.map(t=>pr[t].treasury);
  // f13 for transition Tk-1->Tk is in block (k-1) of the LATER save's history
  const blkT4=blocksFor(bufs.T4, pr.T4.offset);
  const f13=blkT4.map(b=>b[13]); // [turn1income, turn2income, turn3income, 0]
  // net deltas
  const net=[null]; for(let i=1;i<4;i++) net.push(tre[i]-tre[i-1]);
  console.log(`  fid=${fid}: treasury=[${tre.join(",")}] netΔ=[${net.slice(1).join(",")}] f13hist=[${f13.join(",")}]`);
}
