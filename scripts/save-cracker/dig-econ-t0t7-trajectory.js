// dig-econ-t0t7-trajectory.js
// Long clean single-player trajectory (Republic of Rome t0..t7). Track the player
// faction across turns by marker, dump treasury(+0), turnStart, and the full econ
// history (f13 series + the other movers f1,f3,f9,f11). Determine definitively:
//   - does f13(turn N) reproduce any treasury/net figure?
//   - are f1/f3/f9/f11 cumulative income components?
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries, identifyPlayerFactionFromSave, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = ["save_t0.sav","save_t1.sav","save_t2.sav","save_t3.sav","save_t4.sav","save_t5.sav","save_t6.sav","save_t7.sav"];

function ordinal0(buf, core){for(let off=core-4;off>=core-60000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function parseBlock(buf, core){const start=ordinal0(buf,core);if(start<0)return null;const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const marker=f[f.length-1];const body=f.slice(2,f.length-1);const S=23;if(body.length%S)return {marker,bad:true};const bl=[];for(let b=0;b<body.length/S;b++)bl.push(body.slice(b*S,(b+1)*S));return {marker,blocks:bl};}

// Find the PLAYER record per save robustly: identifyPlayerFactionFromSave gives
// the player's faction internal name; then map record->faction via banners/factionId.
function playerRec(buf){
  const recs=parseFactionTreasuries(buf);
  if(!recs.length) return null;
  const owners=identifyFactionRecordOwners(buf, recs);
  const playerName=identifyPlayerFactionFromSave(buf, recs);
  let idx=owners.findIndex(o=>o.factionName===playerName);
  if(idx<0) idx=0;
  return recs[idx];
}

let prevMarker=null;
const rows=[];
for(const f of FILES){
  const p=path.join(BASE,f);
  if(!fs.existsSync(p)){ console.log(`MISSING ${f}`); continue; }
  const buf=fs.readFileSync(p);
  const pr=playerRec(buf);
  if(!pr){ console.log(`${f}: no records`); continue; }
  const pb=parseBlock(buf, pr.offset);
  if(!pb||pb.bad){ console.log(`${f}: bad block`); continue; }
  rows.push({f, marker:pb.marker, fid:pr.factionId, treasury:pr.treasury, turnStart:pr.turnStartTreasury, blocks:pb.blocks});
}

console.log("=== player trajectory (by playerRec heuristic) ===");
for(const r of rows){
  const f13=r.blocks.map(b=>b[13]);
  console.log(`${r.f.padEnd(14)} fid=${r.fid} marker=${r.marker} blocks=${r.blocks.length} treasury=${String(r.treasury).padStart(7)} turnStart=${String(r.turnStart).padStart(7)} f13=[${f13.join(",")}]`);
}

// If marker is stable, use it. Re-track strictly by the most common marker.
const markerCount={};
for(const r of rows){ markerCount[r.marker]=(markerCount[r.marker]||0)+1; }
const stableMarker=Object.entries(markerCount).sort((a,b)=>b[1]-a[1])[0][0];
console.log(`\nstable player marker = ${stableMarker} (seen ${markerCount[stableMarker]}/${rows.length})`);

// Re-pull by stable marker from each save to be certain we follow ONE faction.
function byMarker(buf, marker){
  const recs=parseFactionTreasuries(buf);
  for(const r of recs){ const pb=parseBlock(buf,r.offset); if(pb&&!pb.bad&&String(pb.marker)===String(marker)) return {pr:r,pb}; }
  return null;
}
console.log("\n=== strict marker-tracked trajectory ===");
console.log("turn | treasury | turnStart |  netΔ  | f13(last finalized) | f1last f3last f9last f11last");
let prevT=null;
const series={f1:[],f3:[],f9:[],f11:[],f13final:[],treasury:[]};
FILES.forEach((f,i)=>{
  const p=path.join(BASE,f); if(!fs.existsSync(p))return;
  const buf=fs.readFileSync(p); const hit=byMarker(buf, stableMarker); if(!hit)return;
  const tre=hit.pr.treasury, ts=hit.pr.turnStartTreasury;
  const blocks=hit.pb.blocks;
  const last=blocks[blocks.length-1];
  const finalizedF13 = blocks.length>=2 ? blocks[blocks.length-2][13] : null; // turn (i) finalized
  const netD = prevT===null?null:tre-prevT;
  console.log(`  ${String(i).padStart(2)} | ${String(tre).padStart(7)} | ${String(ts).padStart(8)} | ${String(netD).padStart(6)} | ${String(finalizedF13).padStart(6)} | ${last[1]} ${last[3]} ${last[9]} ${last[11]}`);
  prevT=tre;
  series.treasury.push(tre); series.f1.push(last[1]); series.f3.push(last[3]); series.f9.push(last[9]); series.f11.push(last[11]); series.f13final.push(finalizedF13);
});
console.log("\nf1 deltas :", series.f1.slice(1).map((v,i)=>v-series.f1[i]).join(" "));
console.log("f3 deltas :", series.f3.slice(1).map((v,i)=>v-series.f3[i]).join(" "));
console.log("f9 deltas :", series.f9.slice(1).map((v,i)=>v-series.f9[i]).join(" "));
console.log("treasury  :", series.treasury.join(" "));
console.log("f13 final :", series.f13final.join(" "));
