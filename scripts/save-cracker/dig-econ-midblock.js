// dig-econ-midblock.js
// FACTION_ECONOMICS has 36 FIELDS (registry count constant across saves).
// The faction record's region trailer (after regionIds, before diplomacy) spans
// +(52+4N) .. +(244+4N). For N=22 that's +140..+332 = 48 i32 slots. This is the
// prime candidate for the embedded 36-field economics block. Dump every i32 there
// across the 4 arretium turns and flag economic-looking, turn-varying fields.
//
// Also dump the SAME relative window for an AI faction (seleucid, fid=7) to see if
// the economics fields are present for AI too (they should be).
const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const turns = ["T1","T2","T3","T4"];
const bufs = {}, recs = {};
for (const t of turns) { bufs[t] = fs.readFileSync(path.join(BASE, FILES[t])); recs[t] = parseFactionTreasuries(bufs[t]); }

function dumpFaction(fid, label, treasuryByTurn) {
  console.log(`\n########## ${label} (fid=${fid}) ##########`);
  const pr = {};
  for (const t of turns) {
    pr[t] = recs[t].find(r => r.factionId === fid && (treasuryByTurn ? r.treasury === treasuryByTurn[t] : true));
    if (!pr[t]) { console.log(`[${t}] no record`); return; }
  }
  const N = pr.T1.regionCount;
  console.log(`regionCount=${N}; regionIds end at +${52+4*N}; turnStart@+${92+4*N}; factionId@+${191+4*N}; aiPers@+${227+4*N}; diplo@+${244+4*N}`);
  console.log(`treasury: ${turns.map(t=>pr[t].treasury).join(" ")}`);
  // Dump i32 from +(48+4N) to +(244+4N)
  const lo = 48 + 4*N, hi = 244 + 4*N;
  for (let k = lo; k <= hi; k += 4) {
    if (turns.some(t => pr[t].regionCount !== N)) { /* region count differs */ }
    const vals = turns.map(t => {
      const off = pr[t].offset + k;
      return (off+4<=bufs[t].length) ? bufs[t].readInt32LE(off) : null;
    });
    if (vals.some(v=>v===null)) continue;
    const varies = new Set(vals).size > 1;
    const tag = (k === 92+4*N) ? " <turnStart" : (k === 191+4*N-3?" (faction_id u8 region)":"");
    console.log(`  +${String(k).padStart(4)} : ${vals.map(v=>String(v).padStart(9)).join(" ")}${varies?"  *":""}${tag}`);
  }
}

dumpFaction(5, "PLAYER antigonid", GROUND);
dumpFaction(7, "AI seleucid", null);
