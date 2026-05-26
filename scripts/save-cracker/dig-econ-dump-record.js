// dig-econ-dump-record.js
// Dump the full player (antigonid) class-100 record as i32 across all 4 turns,
// well past the diplomacy block, looking for the 36-field economics struct.
// The diplomacy marker is at +(244 + 4*regionCount). regionCount=22 => 244+88 = +332.
// Print every i32 from -8 to +2000 with all 4 turn values side by side and flag
// any whose per-turn deltas look like income components.

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;

const bufs = {}, pr = {};
for (const [t, f] of Object.entries(FILES)) {
  bufs[t] = fs.readFileSync(path.join(BASE, f));
  const recs = parseFactionTreasuries(bufs[t]);
  pr[t] = recs.find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
}
const turns = ["T1", "T2", "T3", "T4"];
const rc = pr.T1.regionCount;
const diploOff = 244 + 4 * rc;
console.log(`player regionCount=${rc}, diplo marker at +${diploOff}`);
console.log(`per-turn treasury: ${turns.map(t=>GROUND[t]).join(" ")}`);
console.log(`per-turn NET (from prev): T2=+${GROUND.T2-GROUND.T1} T3=+${GROUND.T3-GROUND.T2} T4=+${GROUND.T4-GROUND.T3}\n`);

// To go far past diplo, we need to know diplo entry count. Read it.
for (const t of turns) {
  const off = pr[t].offset + diploOff;
  const marker = bufs[t].readUInt32LE(off);
  const cnt = bufs[t].readUInt32LE(off + 4);
  console.log(`[${t}] diplo marker@+${diploOff}=0x${marker.toString(16)} count=${cnt} -> ends at +${diploOff + 8 + cnt*16}`);
}

console.log("\n=== i32 dump (offset : T1 T2 T3 T4 | dT2 dT3 dT4) for k in [0..2400] ===");
console.log("(flagging rows where values look economic: nonzero, |v|<200000, varies across turns)\n");
for (let k = 0; k <= 2400; k += 4) {
  const vals = turns.map(t => {
    const off = pr[t].offset + k;
    return (off + 4 <= bufs[t].length) ? bufs[t].readInt32LE(off) : null;
  });
  if (vals.some(v => v === null)) continue;
  const dT2 = vals[1] - vals[0], dT3 = vals[2] - vals[1], dT4 = vals[3] - vals[2];
  const varies = new Set(vals).size > 1;
  const economic = varies && vals.every(v => Math.abs(v) < 500000);
  const flag = economic ? "  <== varies" : "";
  // Only print rows that vary OR are near known anchors, to keep output readable
  if (varies) {
    console.log(`  +${String(k).padStart(4)} : ${vals.map(v=>String(v).padStart(9)).join(" ")} | ${String(dT2).padStart(8)} ${String(dT3).padStart(8)} ${String(dT4).padStart(8)}${flag}`);
  }
}
