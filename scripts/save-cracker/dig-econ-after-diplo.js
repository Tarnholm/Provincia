// dig-econ-after-diplo.js
// Re-align the player record dump to AFTER the diplomacy block (variable length),
// so the post-diplo structure lines up across turns. Then scan for economic fields:
//   - per-turn deltas matching net income, OR
//   - any plausible gross/expense components.
// Also compute, for each aligned i32, whether sum of a contiguous run reconstructs net.

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];

const bufs = {}, pr = {}, after = {};
for (const t of turns) {
  bufs[t] = fs.readFileSync(path.join(BASE, FILES[t]));
  const recs = parseFactionTreasuries(bufs[t]);
  pr[t] = recs.find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
  const diploOff = pr[t].offset + 244 + 4 * pr[t].regionCount;
  const cnt = bufs[t].readUInt32LE(diploOff + 4);
  after[t] = diploOff + 8 + cnt * 16; // first byte after diplomacy entries
  console.log(`[${t}] rec@0x${pr[t].offset.toString(16)} diploCount=${cnt} postDiplo=0x${after[t].toString(16)} (rel +${after[t]-pr[t].offset})`);
}

console.log(`\nnet income: T2=+${GROUND.T2-GROUND.T1} T3=+${GROUND.T3-GROUND.T2} T4=+${GROUND.T4-GROUND.T3}`);
console.log("\n=== i32 dump aligned to post-diplomacy start, j in [0..2000] ===");
console.log("(only rows where all 4 turns parse & values vary)\n");
for (let j = 0; j <= 2000; j += 4) {
  const vals = turns.map(t => {
    const off = after[t] + j;
    return (off + 4 <= bufs[t].length) ? bufs[t].readInt32LE(off) : null;
  });
  if (vals.some(v => v === null)) continue;
  if (new Set(vals).size === 1) continue;
  const dT2 = vals[1]-vals[0], dT3 = vals[2]-vals[1], dT4 = vals[3]-vals[2];
  // Highlight rows where magnitude is economic (|v|<200000)
  const econ = vals.every(v => Math.abs(v) < 200000);
  console.log(`  +${String(j).padStart(4)} : ${vals.map(v=>String(v).padStart(8)).join(" ")} | d ${String(dT2).padStart(7)} ${String(dT3).padStart(7)} ${String(dT4).padStart(7)}${econ?"  *":""}`);
}
