// dig-econ-deltas.js
// The player's treasury matches the antigonid class-100 record across all 4 arretium turns.
// Per-turn deltas: T1->T2 = +6833, T2->T3 = +1438, T3->T4 = +1422.
// Goal: find u32/i32 fields whose values at a FIXED offset reproduce the absolute treasury
// AND/OR the per-turn net income. Search the whole file for offsets that read:
//   - the treasury sequence [10000, 16833, 18271, 19693]   (verifies the player record family)
//   - the net-income sequence: at T_n the field equals delta(T_n -> T_{n+1}) OR delta from prev.
//
// Because the player record MOVES between saves (offsets 0x157cacd vs 0x1585714 ...),
// a fixed-file-offset scan won't track it. Instead we scan RELATIVE to the player's
// class-100 record offset (the antigonid record), reading +k for k in a wide window,
// and look for the income breakdown that sits inside / near that record.

const fs = require("fs");
const path = require("path");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = {
  T1: "save_arretium pre retrained..sav",
  T2: "save_arretium retrained turn 2.sav",
  T3: "save_arretium turn 3.sav",
  T4: "save_arretium turn 4.sav",
};
const GROUND = { T1: 10000, T2: 16833, T3: 18271, T4: 19693 };
const PLAYER_FID = 5; // antigonid record carries the player's treasury

const bufs = {}, recs = {}, playerRec = {};
for (const [t, f] of Object.entries(FILES)) {
  bufs[t] = fs.readFileSync(path.join(BASE, f));
  recs[t] = parseFactionTreasuries(bufs[t]);
  playerRec[t] = recs[t].find(r => r.factionId === PLAYER_FID && r.treasury === GROUND[t]);
  console.log(`[${t}] player(antigonid) rec @0x${playerRec[t].offset.toString(16)} treasury=${playerRec[t].treasury} regions=${playerRec[t].regionCount}`);
}

const turns = ["T1", "T2", "T3", "T4"];
const treasurySeq = turns.map(t => GROUND[t]);
const deltaToNext = { T1: GROUND.T2 - GROUND.T1, T2: GROUND.T3 - GROUND.T2, T3: GROUND.T4 - GROUND.T3 }; // +6833,+1438,+1422
const deltaFromPrev = { T2: GROUND.T2 - GROUND.T1, T3: GROUND.T3 - GROUND.T2, T4: GROUND.T4 - GROUND.T3 };
console.log(`\ntreasury seq: [${treasurySeq}]`);
console.log(`delta-to-next: T1=+${deltaToNext.T1} T2=+${deltaToNext.T2} T3=+${deltaToNext.T3}`);
console.log(`delta-from-prev: T2=+${deltaFromPrev.T2} T3=+${deltaFromPrev.T3} T4=+${deltaFromPrev.T4}`);

// Scan a window [-200 .. +4000] relative to each player record offset, reading i32 at each +k.
// For each k, collect the 4 values across turns; classify.
const WIN_LO = -256, WIN_HI = 4096;
console.log(`\n=== Scanning i32 at player.offset + k for k in [${WIN_LO}..${WIN_HI}] ===`);

const treasuryHits = [];
const deltaNextHits = [];
const deltaPrevHits = [];
for (let k = WIN_LO; k <= WIN_HI; k++) {
  let vals;
  try {
    vals = turns.map(t => {
      const off = playerRec[t].offset + k;
      if (off < 0 || off + 4 > bufs[t].length) return null;
      return bufs[t].readInt32LE(off);
    });
  } catch { continue; }
  if (vals.some(v => v === null)) continue;

  // (a) exact treasury sequence
  if (vals[0] === treasurySeq[0] && vals[1] === treasurySeq[1] && vals[2] === treasurySeq[2] && vals[3] === treasurySeq[3]) {
    treasuryHits.push({ k, vals });
  }
  // (b) value at T equals delta-to-next  (income earned next turn — predictive, less likely)
  if (vals[0] === deltaToNext.T1 && vals[1] === deltaToNext.T2 && vals[2] === deltaToNext.T3) {
    deltaNextHits.push({ k, vals });
  }
  // (c) value at T equals delta-from-prev  (income earned this turn, posted at turn start)
  if (vals[1] === deltaFromPrev.T2 && vals[2] === deltaFromPrev.T3 && vals[3] === deltaFromPrev.T4) {
    deltaPrevHits.push({ k, vals });
  }
}

console.log(`\nTREASURY-sequence offsets (k => relative to player rec):`);
for (const h of treasuryHits) console.log(`  +${h.k} : [${h.vals}]`);

console.log(`\nDELTA-TO-NEXT offsets (field@T = income earned the FOLLOWING turn):`);
for (const h of deltaNextHits.slice(0, 40)) console.log(`  +${h.k} : [${h.vals}]`);
console.log(`  (${deltaNextHits.length} total)`);

console.log(`\nDELTA-FROM-PREV offsets (field@T = income earned the PREVIOUS turn):`);
for (const h of deltaPrevHits.slice(0, 40)) console.log(`  +${h.k} : [${h.vals}]`);
console.log(`  (${deltaPrevHits.length} total)`);
