// dig-econ-gross-locate.js
// The in-game finance UI gross settlement income (T1=6347 T2=6339 T3=6338
// T4=6539) does NOT appear in the pre-record block. Locate where (if anywhere)
// these exact values are serialized, and how far from the player core. Also test
// f13's nature: cumulative gross income? Print f13 and f13 deltas, and compare to
// (treasury - turnStartTreasury) per turn for the player.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const GROSS = { T1: 6347, T2: 6339, T3: 6338, T4: 6539 };
const turns = ["T1","T2","T3","T4"];

const bufs={}, pr={};
for(const t of turns){bufs[t]=fs.readFileSync(path.join(BASE,FILES[t]));pr[t]=parseFactionTreasuries(bufs[t]).find(r=>r.factionId===5&&r.treasury===GROUND[t]);}

function findAll(buf,val){const o=[];for(let i=0;i+4<=buf.length;i++)if(buf.readInt32LE(i)===val)o.push(i);return o;}

console.log("=== gross-income value occurrences & Δ to player core ===");
for(const t of turns){
  const occ=findAll(bufs[t],GROSS[t]);
  const near=occ.filter(o=>Math.abs(o-pr[t].offset)<20000).map(o=>`Δ${o-pr[t].offset}`);
  console.log(`  ${t} gross=${GROSS[t]}: ${occ.length} total; within 20KB of core: ${near.join(" ")||"(none)"}`);
}

// turnStartTreasury per turn (already parsed) - net within turn = treasury-turnStart.
console.log("\n=== turnStartTreasury & within-turn net (player) ===");
for(const t of turns){
  console.log(`  ${t}: treasury=${pr[t].treasury} turnStart=${pr[t].turnStartTreasury} within-turn=${pr[t].treasury-pr[t].turnStartTreasury}`);
}

// f13 nature test
function ordinal0(buf, core){for(let off=core-4;off>=core-20000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function blocksFor(buf, core){const start=ordinal0(buf,core);const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const body=f.slice(2,f.length-1);const S=23,n=body.length/S;const bl=[];for(let b=0;b<n;b++)bl.push(body.slice(b*S,(b+1)*S));return bl;}
console.log("\n=== f13 per block in EACH save (should match across saves for same turn) ===");
for(const t of turns){
  const bl=blocksFor(bufs[t],pr[t].offset);
  console.log(`  ${t}: f13=[${bl.map(b=>b[13]).join(",")}]  f1=[${bl.map(b=>b[1]).join(",")}]  f5=[${bl.map(b=>b[5]).join(",")}]  f8=[${bl.map(b=>b[8]).join(",")}]`);
}
// Is the within-turn net (treasury-turnStart) present as any field of the CURRENT (last) block?
console.log("\n=== within-turn net vs current-block fields ===");
for(const t of turns){
  const bl=blocksFor(bufs[t],pr[t].offset);
  const cur=bl[bl.length-1];
  const wnet=pr[t].treasury-pr[t].turnStartTreasury;
  const hits=cur.map((v,f)=>v===wnet?`f${f}`:null).filter(Boolean);
  console.log(`  ${t}: within-turn net=${wnet} -> matches current-block fields: ${hits.join(",")||"(none)"}`);
}
