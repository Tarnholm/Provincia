// dig-econ-prediplo-fields.js
// FACTION_ECONOMICS is NOT a separate array (treasury not replicated). It must be
// EMBEDDED in the class-100 FACTION record. The record's FIXED region runs from a
// little before +0 up to the diplomacy marker at +(244+4*regions)=+332 (regions=22).
// Region-IDs occupy +52..+140 (22*4). Treasury copy at +180. Decode every i32 in
// [-64 .. +332] across all 4 turns; flag economic candidates:
//   - tracks net delta (+6833,+1438,+1422)
//   - equals treasury / treasury-copy
//   - equals gross settlement income (6347,6339,6338,6539)
//   - small varying positive ints (income components)

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const GROSS = { T1: 6347, T2: 6339, T3: 6338, T4: 6539 };
const NET = { T2: 6833, T3: 1438, T4: 1422 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];

const bufs = {}, pr = {};
for (const t of turns) {
  bufs[t] = fs.readFileSync(path.join(BASE, FILES[t]));
  const recs = parseFactionTreasuries(bufs[t]);
  pr[t] = recs.find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
}
const rc = pr.T1.regionCount;
console.log(`player regionCount=${rc}; region IDs +52..+${52+4*rc}; diplo +${244+4*rc}`);
console.log(`treasury: ${turns.map(t=>GROUND[t]).join(" ")}  gross: ${turns.map(t=>GROSS[t]).join(" ")}`);
console.log(`net:        --   +${NET.T2} +${NET.T3} +${NET.T4}\n`);

for (let k = -64; k <= 244 + 4*rc; k += 4) {
  const vals = turns.map(t => {
    const off = pr[t].offset + k;
    return (off >= 0 && off + 4 <= bufs[t].length) ? bufs[t].readInt32LE(off) : null;
  });
  if (vals.some(v => v === null)) continue;
  const dT2=vals[1]-vals[0], dT3=vals[2]-vals[1], dT4=vals[3]-vals[2];
  const flags = [];
  if (dT2===NET.T2 && dT3===NET.T3 && dT4===NET.T4) flags.push("NET-TRACK");
  if (turns.every((t,i)=>vals[i]===GROUND[t])) flags.push("TREASURY");
  if (turns.every((t,i)=>vals[i]===GROSS[t])) flags.push("GROSS-INCOME");
  if (turns.every((t,i)=>vals[i]===-GROSS[t])) flags.push("NEG-GROSS");
  const isRegionId = k >= 52 && k < 52 + 4*rc;
  const tag = isRegionId ? " (regionID)" : "";
  const varies = new Set(vals).size > 1;
  // Print everything in fixed region; mark variers + flags
  console.log(`  +${String(k).padStart(4)} : ${vals.map(v=>String(v).padStart(10)).join(" ")} | ${String(dT2).padStart(7)} ${String(dT3).padStart(7)} ${String(dT4).padStart(7)}${varies?" v":"  "}${flags.length?"  <== "+flags.join(","):""}${tag}`);
}
