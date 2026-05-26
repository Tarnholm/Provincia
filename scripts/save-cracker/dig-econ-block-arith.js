// dig-econ-block-arith.js
// Full per-turn block table. Identify treasury & net by brute arithmetic over
// the non-zero fields (f0,f1,f3,f9,f11,f12,f13,f22) WITHIN and ACROSS blocks.
// Treasury at save time: T1=10000 T2=16833 T3=18271 T4=19693.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];

function ordinal0(buf, core){for(let off=core-4;off>=core-4000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function blocksFor(buf, core){const start=ordinal0(buf,core);const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const body=f.slice(2,f.length-1);const S=23,n=body.length/S;const bl=[];for(let b=0;b<n;b++)bl.push(body.slice(b*S,(b+1)*S));return bl;}

const blk = {};
for (const t of turns) {
  const buf = fs.readFileSync(path.join(BASE, FILES[t]));
  const pr = parseFactionTreasuries(buf).find(r => r.factionId===PLAYER_FID && r.treasury===GROUND[t]);
  blk[t] = blocksFor(buf, pr.offset);
}

// Print full table: for each turn, each block, the interesting fields.
const IF = [0,1,3,5,8,9,11,12,13,22];
console.log("=== full block table (interesting fields) ===");
for (const t of turns) {
  console.log(`\n${t} (treasury=${GROUND[t]}), ${blk[t].length} blocks:`);
  blk[t].forEach((b,i) => {
    console.log(`  blk${i}: ` + IF.map(f=>`f${f}=${String(b[f]).padStart(6)}`).join(" "));
  });
}

// Test: does treasury = (some field of last block) - (some field)?  Or does
// last-block.f1 grow consistent with treasury? f1 = 18761,24129,24452,24848.
// treasury delta vs f1 delta:
console.log("\n=== treasury vs f1 (last block) ===");
const f1last = turns.map(t=>blk[t][blk[t].length-1][1]);
console.log("  f1 last:", f1last.join(" "), " Δ:", f1last.slice(1).map((v,i)=>v-f1last[i]).join(" "));
console.log("  treasury:", turns.map(t=>GROUND[t]).join(" "), " Δ:", [6833,1438,1422].join(" "));

// Maybe f13 of the COMPLETED (second-to-last) block is cumulative income, and
// treasury = f13 + something. T2 blk0.f13=9900, T3 blk1.f13=16450, T4 blk2.f13=18300.
console.log("\n=== f13 of completed (2nd-to-last) block ===");
for (let i=1;i<turns.length;i++){
  const t=turns[i]; const b=blk[t][blk[t].length-2];
  console.log(`  ${t}: completed-blk f13=${b[13]} f0=${b[0]} f1=${b[1]} f12=${b[12]} f22=${b[22]}  treasury=${GROUND[t]} prevTreasury=${GROUND[turns[i-1]]}`);
}

// Brute force: for the LAST block of each turn, find a linear combo of fields
// (coeffs in -1,0,1) that equals treasury for ALL turns simultaneously.
console.log("\n=== brute single/pair field combos == treasury (all turns) ===");
const NF=23;
function lastVal(t,f){return blk[t][blk[t].length-1][f];}
// singles
for (let f=0; f<NF; f++){
  if (turns.every(t=>lastVal(t,f)===GROUND[t])) console.log(`  f${f} == treasury`);
}
// pairs a+b, a-b
for (let a=0;a<NF;a++)for(let b=0;b<NF;b++){
  if (turns.every(t=>lastVal(t,a)+lastVal(t,b)===GROUND[t])) console.log(`  f${a}+f${b} == treasury`);
  if (a!==b && turns.every(t=>lastVal(t,a)-lastVal(t,b)===GROUND[t])) console.log(`  f${a}-f${b} == treasury`);
}
// scaled f1? treasury looks ~ f1 - constant? f1-treasury: 8761,7296,6181,5155 -> not const.
console.log("\n  f1-treasury:", turns.map(t=>lastVal(t,1)-GROUND[t]).join(" "));
console.log("  f0-treasury:", turns.map(t=>lastVal(t,0)-GROUND[t]).join(" "));
console.log("  f12-treasury:", turns.map(t=>lastVal(t,12)-GROUND[t]).join(" "));
