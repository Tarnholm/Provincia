// dig-econ-before-record.js
// The 36-field econ object may be serialized JUST BEFORE each faction's class-100
// record (RTW often writes sub-objects before the owning object). Dump i32 from
// player.offset-600 .. player.offset across the 4 turns, aligned to the record
// START (which we can track because parseFactionTreasuries finds it each turn).
// Flag economic, turn-varying fields. Compare net (+6833/+1438/+1422) and the
// settlement gross (6347/6339/6338/6539).
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const turns = ["T1","T2","T3","T4"];
const bufs={}, pr={};
for (const t of turns){bufs[t]=fs.readFileSync(path.join(BASE,FILES[t]));const r=parseFactionTreasuries(bufs[t]);pr[t]=r.find(x=>x.factionId===5&&x.treasury===GROUND[t]);}

console.log("net (Δtreasury): T2=+6833 T3=+1438 T4=+1422");
console.log("gross settlement income: T1=6347 T2=6339 T3=6338 T4=6539\n");
console.log("=== i32 BEFORE record start (k from -800 to -4) ===");
for (let k=-800;k<=-4;k+=4){
  const vals=turns.map(t=>{const o=pr[t].offset+k;return (o>=0&&o+4<=bufs[t].length)?bufs[t].readInt32LE(o):null;});
  if (vals.some(v=>v===null))continue;
  if (new Set(vals).size===1)continue;
  console.log(`  ${String(k).padStart(5)} : ${vals.map(v=>String(v).padStart(9)).join(" ")}`);
}
