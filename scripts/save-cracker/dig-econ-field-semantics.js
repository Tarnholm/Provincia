// dig-econ-field-semantics.js
// Decode the 23-field FACTION_ECONOMICS history block field-by-field, using
// economic reasoning + cross-faction magnitude. Player block (T4) field traj:
//   f0 :33792 34621 34576 34586   (large, ~constant -> total economy / GDP base?)
//   f1 :24152 24463 24848 24848   (large, monotonic up -> cumulative something)
//   f3 : 5426  5601  5767  5783    (mid, monotonic up)
//   f5 :    0    60   106    0     (sparse)
//   f8 :    0     0  1365    0     (sparse spike on retrain turn!)
//   f9 :  671   723   773   789    (small, monotonic up)
//   f11: 2150  2350  2350  2350    (round, steps)
//   f12:33996 33931 33486 33526    (large, drifting)
//   f13: 9900 16450 18300    0     (money, per completed turn)
//   f22:11162 11299 11877 11851    (mid)
// Hypothesis: f0=population total, f12=happiness/loyalty pool, f1=cumulative
// trade?, f13=gross faction income (treasury-relevant). f8 spiked exactly on the
// turn the player did a retrain (turn3 block2) -> f8 may be MILITARY UPKEEP delta
// or CONSTRUCTION/RECRUIT spend. Print everything + AI factions for contrast.
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1:"save_arretium pre retrained..sav",T2:"save_arretium retrained turn 2.sav",T3:"save_arretium turn 3.sav",T4:"save_arretium turn 4.sav" };
const GROUND = { T1:10000,T2:16833,T3:18271,T4:19693 };
const turns=["T1","T2","T3","T4"];

function ordinal0(buf, core){for(let off=core-4;off>=core-20000;off-=4){if(off<0)break;if(buf.readUInt32LE(off)===off)return off;}return -1;}
function blocksFor(buf, core){const start=ordinal0(buf,core);const f=[];for(let o=start;o+4<=core;o+=4)f.push(buf.readInt32LE(o));const body=f.slice(2,f.length-1);const S=23,n=body.length/S;const bl=[];for(let b=0;b<n;b++)bl.push(body.slice(b*S,(b+1)*S));return bl;}

const bufs={}, recsAll={};
for(const t of turns){bufs[t]=fs.readFileSync(path.join(BASE,FILES[t]));recsAll[t]=parseFactionTreasuries(bufs[t]);}

// Player blocks across T4 (the complete history).
const prT4 = recsAll.T4.find(r=>r.factionId===5&&r.treasury===GROUND.T4);
const pb = blocksFor(bufs.T4, prT4.offset);

// Treasury trajectory & net (the player did retrains: net != gross).
const tre=[10000,16833,18271,19693];
const net=[6833,1438,1422];

console.log("=== Field trajectory matrix (player, T4 history, blocks 0..3) ===");
console.log("turn:        T1     T2     T3     T4   | per-turn Δ");
for(let f=0;f<23;f++){
  const series=pb.map(b=>b[f]);
  if(series.every(v=>v===0)) continue;
  const d=series.slice(1).map((v,i)=>v-series[i]);
  console.log(`  f${String(f).padStart(2)}: ${series.map(v=>String(v).padStart(7)).join(" ")} | ${d.map(v=>String(v).padStart(6)).join(" ")}`);
}

// f13 represents finalized money for completed turns: 9900,16450,18300.
// Test: f13[turn] vs treasury[turn] and vs treasury[turn]-expenses.
console.log("\n=== f13 vs treasury & net analysis ===");
console.log("  f13 (completed turns 1,2,3):", pb.slice(0,3).map(b=>b[13]).join(" "));
console.log("  treasury at save:            ", tre.join(" "));
console.log("  treasury delta (net):        --", net.join(" "));
console.log("  f13 deltas:                  ", pb.slice(0,3).map(b=>b[13]).slice(1).map((v,i)=>v-pb[i][13]).join(" "));
console.log("  treasury - f13:              ", [0,1,2].map(i=>tre[i+1]-pb[i][13]).join(" "), "(treasury(turn k+1) - f13(turn k))");
console.log("  f13 - treasury(same idx):    ", [0,1,2].map(i=>pb[i][13]-tre[i]).join(" "));

// f1 monotonic: 24152 24463 24848 24848. Could be CUMULATIVE GROSS income since
// start. Cumulative gross (user-reported per-turn gross 6347,6339,6338,6539):
const gross=[6347,6339,6338,6539];
let cum=0; const cumGross=gross.map(g=>cum+=g);
console.log("\n=== f1 vs cumulative gross income ===");
console.log("  f1:           ", pb.map(b=>b[1]).join(" "));
console.log("  cumGross:     ", cumGross.join(" "));
console.log("  f1 deltas:    ", pb.map(b=>b[1]).slice(1).map((v,i)=>v-pb[i][1]).join(" "), "(vs per-turn gross 6339,6338,6539)");

// f8 spiked to 1365 on turn3 block2. The player retrained on turn? Check what
// changed. Print f8 across all factions T4 to see if it's a spend event marker.
console.log("\n=== f8 (spend/event spike?) across factions T4 ===");
for(const r of recsAll.T4.slice(0,10)){
  const bl=blocksFor(bufs.T4, r.offset);
  console.log(`  fid=${String(r.factionId).padStart(3)} treasury=${String(r.treasury).padStart(8)} f8=[${bl.map(b=>b[8]).join(",")}] f5=[${bl.map(b=>b[5]).join(",")}] f13=[${bl.map(b=>b[13]).join(",")}]`);
}
