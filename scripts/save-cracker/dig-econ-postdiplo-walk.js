// dig-econ-postdiplo-walk.js
// The player faction record's post-diplomacy region SHIFTS by 16 bytes per extra
// diplo entry (T1/T2 diplo count=34 -> ends +884; T3/T4 count=35 -> ends +900).
// So absolute +k offsets past +332 are NOT comparable across turns. Re-anchor on
// the diplo-block END so we get a STABLE per-turn view of whatever follows
// (likely the FACTION_ECONOMICS sub-block).
//
// Dump i32 starting from diploEnd-16 to diploEnd+1200 with all 4 turns aligned
// and flag rows whose deltas track the treasury trajectory (+6833,+1438,+1422)
// or whose absolute values equal a treasury (10000/16833/18271/19693).

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5;
const turns = ["T1", "T2", "T3", "T4"];
const treasurySet = new Set(Object.values(GROUND));
const NET = { T2: 6833, T3: 1438, T4: 1422 }; // treasury delta from previous turn

const bufs = {}, pr = {}, diploEnd = {};
for (const t of turns) {
  bufs[t] = fs.readFileSync(path.join(BASE, FILES[t]));
  const recs = parseFactionTreasuries(bufs[t]);
  pr[t] = recs.find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
  const diploOff = 244 + 4 * pr[t].regionCount;
  const cnt = bufs[t].readUInt32LE(pr[t].offset + diploOff + 4);
  diploEnd[t] = diploOff + 8 + cnt * 16;
  console.log(`[${t}] rec@0x${pr[t].offset.toString(16)} regions=${pr[t].regionCount} diploOff=+${diploOff} diploCount=${cnt} diploEnd=+${diploEnd[t]}`);
}

console.log(`\nground treasury: ${turns.map(t=>GROUND[t]).join(" ")}`);
console.log(`net delta:        --   +${NET.T2} +${NET.T3} +${NET.T4}\n`);

// Anchor each turn at its own diploEnd. Walk a relative index e from -16..+1400.
console.log("=== i32 dump anchored at diploEnd (e : T1 T2 T3 T4 | dT2 dT3 dT4 flags) ===");
const matches = { treasury: [], netTrack: [] };
for (let e = -16; e <= 1400; e += 4) {
  const vals = turns.map(t => {
    const off = pr[t].offset + diploEnd[t] + e;
    return (off >= 0 && off + 4 <= bufs[t].length) ? bufs[t].readInt32LE(off) : null;
  });
  if (vals.some(v => v === null)) continue;
  const dT2 = vals[1]-vals[0], dT3 = vals[2]-vals[1], dT4 = vals[3]-vals[2];
  const varies = new Set(vals).size > 1;
  // Flag: matches treasury absolute in every turn
  const isTreasury = turns.every((t,i) => vals[i] === GROUND[t]);
  // Flag: deltas track net income
  const tracksNet = dT2 === NET.T2 && dT3 === NET.T3 && dT4 === NET.T4;
  let flag = "";
  if (isTreasury) { flag += " <==TREASURY"; matches.treasury.push(e); }
  if (tracksNet) { flag += " <==NET-TRACK"; matches.netTrack.push(e); }
  const economic = varies && vals.every(v => Math.abs(v) < 500000);
  if (varies || isTreasury || tracksNet) {
    const mark = economic ? " ." : "";
    console.log(`  e=${String(e).padStart(5)} : ${vals.map(v=>String(v).padStart(10)).join(" ")} | ${String(dT2).padStart(8)} ${String(dT3).padStart(8)} ${String(dT4).padStart(8)}${mark}${flag}`);
  }
}

console.log(`\nSUMMARY: treasury-abs matches at e=${JSON.stringify(matches.treasury)}, net-tracking at e=${JSON.stringify(matches.netTrack)}`);
