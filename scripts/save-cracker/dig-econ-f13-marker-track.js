// dig-econ-f13-marker-track.js
// The per-faction econ block has a stable MARKER (trailer i32, e.g. 414337867 for
// the arretium player) — a per-faction hash that does NOT change turn to turn
// within a campaign. Use it to track the SAME faction record across save pairs,
// avoiding the unreliable factionId/lowest-offset heuristics.
//
// For each faction (keyed by marker) gather (treasury+0, turnStartTreasury,
// full f13 history). Then on the Dummies Turn-7-End / Turn-8-Start pair (clean,
// same player) determine precisely what f13 encodes vs the live treasury.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function ordinal0(buf, core){for(let off=core-4;off>=core-60000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function parseBlock(buf, core){const start=ordinal0(buf,core);if(start<0)return null;const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const marker=f[f.length-1];const body=f.slice(2,f.length-1);const S=23;if(body.length%S)return {marker,bad:true};const bl=[];for(let b=0;b<body.length/S;b++)bl.push(body.slice(b*S,(b+1)*S));return {marker,blocks:bl};}

function factionMap(name){
  const p=path.join(BASE,name);
  if(!fs.existsSync(p)) return null;
  const buf=fs.readFileSync(p);
  const recs=parseFactionTreasuries(buf);
  const m=new Map();
  for(const r of recs){
    const pb=parseBlock(buf,r.offset);
    if(!pb||pb.bad) continue;
    m.set(pb.marker, { treasury:r.treasury, turnStart:r.turnStartTreasury, factionId:r.factionId, f13:pb.blocks.map(b=>b[13]), blocks:pb.blocks, offset:r.offset });
  }
  return m;
}

// Dummies clean pair.
const endM = factionMap("save_Autosave   Dummies   Turn 7 End.sav");
const startM = factionMap("save_Autosave   Dummies   Turn 8 Start.sav");

console.log("=== Dummies Turn7-End vs Turn8-Start, matched by marker ===");
console.log("marker          | END(tre,turnStart,f13last) | START(tre,turnStart,newF13)");
for(const [mk, e] of endM){
  const s=startM.get(mk);
  if(!s) continue;
  // END: 7 blocks (block6 = current turn7). START: 8 blocks (block6 now finalized, block7 current).
  const endCur = e.blocks[e.blocks.length-1];          // turn7 in-progress
  const justFinalized = s.blocks[s.blocks.length-2];   // turn7 finalized in start save
  console.log(`${String(mk).padStart(12)} | tre=${String(e.treasury).padStart(8)} ts=${String(e.turnStart).padStart(8)} curF13=${endCur[13]} | tre=${String(s.treasury).padStart(8)} ts=${String(s.turnStart).padStart(8)} turn7-finalF13=${justFinalized[13]}`);
}

// Focus on the player marker (the one whose f13 history is the dummies series we saw).
console.log("\n=== detailed: the marker with the longest non-trivial f13 history ===");
let best=null,bestLen=-1;
for(const [mk,e] of endM){ const nz=e.f13.filter(v=>v!==0).length; if(nz>bestLen){bestLen=nz;best=mk;} }
const e=endM.get(best), s=startM.get(best);
console.log(`player marker=${best} fid=${e.factionId}`);
console.log(`  END   treasury+0=${e.treasury} turnStart=${e.turnStart}  f13=[${e.f13.join(",")}]`);
console.log(`  START treasury+0=${s.treasury} turnStart=${s.turnStart}  f13=[${s.f13.join(",")}]`);
// Relationships
console.log(`\n  RELATIONSHIPS:`);
console.log(`  END turnStart (==treasury at start of turn7) = ${e.turnStart}`);
console.log(`  START turn6-finalized f13 = ${s.f13[s.f13.length-3]}  (vs END turnStart=${e.turnStart})  match=${s.f13[s.f13.length-3]===e.turnStart}`);
console.log(`  START turn7-finalized f13 = ${s.f13[s.f13.length-2]}  (vs START turnStart=${s.turnStart})  match=${s.f13[s.f13.length-2]===s.turnStart}`);
console.log(`  => HYPOTHESIS: f13(turn N) == turnStartTreasury of save taken at START of turn N+1`);

// Cross-check on arretium: the f13 of each completed turn should == the
// turnStartTreasury read from the NEXT turn's save.
console.log("\n=== arretium cross-check: f13(turn N) vs turnStart(save N+1) ===");
const AF = { T1:"save_arretium pre retrained..sav",T2:"save_arretium retrained turn 2.sav",T3:"save_arretium turn 3.sav",T4:"save_arretium turn 4.sav" };
const AG = { T1:10000,T2:16833,T3:18271,T4:19693 };
const at=["T1","T2","T3","T4"];
const am={};
for(const t of at){ const mm=factionMap(AF[t]); // find player marker 414337867
  am[t]=mm.get(414337867); }
for(let i=0;i<at.length;i++){
  const t=at[i]; const e=am[t];
  console.log(`  ${t}: treasury+0=${e.treasury} turnStart=${e.turnStart} f13hist=[${e.f13.join(",")}]`);
}
console.log("  --- pairing f13(turn N) with turnStart(save of turn N+1) ---");
for(let i=0;i+1<at.length;i++){
  const tN=at[i], tN1=at[i+1];
  const f13turnN = am[tN].f13[am[tN].f13.length-2] // last finalized in save N is turn N-1...
  // Actually: in save T(k), blocks 0..k-2 are finalized (turns 1..k-1), block k-1 is current(turn k).
  // f13 for turn k is finalized in save T(k+1) as block k-1.
  ;
  const finalizedTurnK = am[tN1].f13[am[tN1].f13.length-2]; // turn (k) finalized in save T(k+1)
  console.log(`  turn ${i+1} finalized-f13 (from ${tN1} save) = ${finalizedTurnK} ; turnStart(${tN1})=${am[tN1].turnStart} ; treasury+0(${tN1})=${am[tN1].treasury}`);
}
