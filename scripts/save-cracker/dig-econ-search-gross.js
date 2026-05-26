// dig-econ-search-gross.js
// Player's gross settlement income per turn: T1=6347 T2=6339 T3=6338 T4=6539.
// Search each turn's file for that exact value and see if occurrences cluster at a
// consistent location (the FACTION_ECONOMICS object). Cross-turn: an offset that
// reads [6347,6339,6338,6539] is the section (but it moves, so search per-turn and
// intersect by proximity).
const fs = require("fs");
const path = require("path");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROSS = { T1: 6347, T2: 6339, T3: 6338, T4: 6539 };

function findAll(buf, v) {
  const out = []; const t = Buffer.alloc(4); t.writeInt32LE(v);
  let p = 0; while ((p = buf.indexOf(t, p)) !== -1) { out.push(p); p++; }
  return out;
}

const occ = {};
for (const [t, f] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(BASE, f));
  occ[t] = { buf, hits: findAll(buf, GROSS[t]) };
  console.log(`[${t}] gross=${GROSS[t]} -> ${occ[t].hits.length} occurrences: ${occ[t].hits.map(o=>"0x"+o.toString(16)).join(", ")}`);
}

// For each T1 occurrence offset, check whether T2/T3/T4 read THEIR gross at a nearby
// offset (the section moves a little, but the player's econ object should be in the
// same body region). Print clusters where all 4 turns have a gross hit within 64KB.
console.log("\n=== cross-turn proximity clusters (within +-64KB) ===");
for (const o1 of occ.T1.hits) {
  const near = (hits, lo, hi) => hits.find(h => h >= lo && h <= hi);
  const o2 = near(occ.T2.hits, o1 - 65536, o1 + 65536);
  const o3 = near(occ.T3.hits, o1 - 65536, o1 + 65536);
  const o4 = near(occ.T4.hits, o1 - 65536, o1 + 65536);
  if (o2 && o3 && o4) {
    console.log(`  T1@0x${o1.toString(16)} T2@0x${o2.toString(16)} T3@0x${o3.toString(16)} T4@0x${o4.toString(16)}`);
    // dump 64 bytes context around each as i32
    for (const [t, o] of [["T1",o1],["T2",o2],["T3",o3],["T4",o4]]) {
      const b = occ[t].buf; const arr = [];
      for (let k=-8;k<=12;k+=4) arr.push(b.readInt32LE(o+k));
      console.log(`     ${t} ctx[-8..+12]: ${arr.join(" ")}`);
    }
  }
}
