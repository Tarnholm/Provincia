// dig-econ-before-ordinal0.js
// Map the bytes BEFORE the ordinal0 econ-history self-ptr. The prior run saw
// MORE self-ptrs in T1 (at core-3960, core-3976 = a 3832-byte blob, then
// core-128/-108/-104). Determine the full object chain in front of the FACTION
// core and whether a 36-field FACTION_ECONOMICS object lives just before the
// 23-field history. Anchor per-turn on ordinal0 (the history self-ptr) and dump
// the 64 i32 immediately preceding it, aligned across turns.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1:"save_arretium pre retrained..sav",T2:"save_arretium retrained turn 2.sav",T3:"save_arretium turn 3.sav",T4:"save_arretium turn 4.sav" };
const GROUND = { T1:10000,T2:16833,T3:18271,T4:19693 };
const turns=["T1","T2","T3","T4"];

function ordinal0(buf, core){for(let off=core-4;off>=core-60000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}

const bufs={}, pr={}, o0={};
for(const t of turns){bufs[t]=fs.readFileSync(path.join(BASE,FILES[t]));pr[t]=parseFactionTreasuries(bufs[t]).find(r=>r.factionId===5&&r.treasury===GROUND[t]);o0[t]=ordinal0(bufs[t],pr[t].offset);}

console.log("ordinal0 (econ history self-ptr) per turn:");
for(const t of turns) console.log(`  ${t}: o0=0x${o0[t].toString(16)} (Δcore=${o0[t]-pr[t].offset}); core=0x${pr[t].offset.toString(16)}`);

// Dump 80 i32 before o0, anchored at o0 (relative index e = o0-? ). Use e from -80*4 to 0.
console.log("\n=== i32 in [o0-320 .. o0] aligned across turns (anchor=ordinal0) ===");
for(let e=-320;e<=0;e+=4){
  const vals=turns.map(t=>{const off=o0[t]+e;return (off>=0&&off+4<=bufs[t].length)?bufs[t].readInt32LE(off):null;});
  if(vals.some(v=>v===null))continue;
  const varies=new Set(vals).size>1;
  // self-ptr?
  const isSelf=turns.every((t,i)=>vals[i]===(o0[t]+e));
  console.log(`  e=${String(e).padStart(5)} : ${vals.map(v=>String(v).padStart(11)).join(" ")}${isSelf?" SELFPTR":""}${varies?" v":""}`);
}

// Also: list ALL self-ptrs in [core-5000, core] per turn with their deltas, so we
// can see the full object framing (the prior run's -128/-108/-104 + -3960/-3976).
console.log("\n=== ALL self-ptrs in [core-6000, core] per turn (Δcore) ===");
for(const t of turns){
  const list=[];
  for(let off=pr[t].offset-4;off>=pr[t].offset-6000;off-=4){ if(off<0)break; if(bufs[t].readUInt32LE(off)===off) list.push(off-pr[t].offset); }
  console.log(`  ${t}: ${list.reverse().join(" ")}`);
}
