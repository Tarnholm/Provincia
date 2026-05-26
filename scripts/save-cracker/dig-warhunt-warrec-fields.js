// dig-warhunt-warrec-fields.js
// Examine the EXACT war-flip records at byte 0x11921 and 0x17bf1 across ALL
// states. Which fields are stable across declare/besieged/T4 (=> war state)
// vs which are battle-specific noise?
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const states = [
  ["T3End", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4Start", "save_Autosave   Spain   Turn 4 Start.sav"],
  ["declare", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["besieged", "save_Autosave   Spain   Turn 4 besiged .sav"],
  ["besCorduba", "save_Autosave   Spain   Turn 4 besiged corduba.sav"],
  ["T4", "save_Autosave   Spain   Turn 4.sav"],
];
const bufs = states.map(([t, f]) => [t, fs.readFileSync(SAVES_DIR + f)]);

// The record head (byte offset where the `0d 00 00 00` key sits) for the two
// flipped records — these absolute offsets are valid for the ALIGNED saves
// (T4Start..T4 share marker at 0x3f74a). For T3End the offsets shift, so we
// re-locate by content there. Record A head=0x11921, record B head=0x17bf1.
const recs = [0x11921, 0x17bf1];

for (const head of recs) {
  console.log(`\n===== record head 0x${head.toString(16)} (12 u32 from head) =====`);
  console.log("state        " + Array.from({length:12}, (_,i)=>("w"+i).padStart(6)).join(""));
  for (const [tag, b] of bufs) {
    // For aligned saves use head directly; for T3End the structure shifted ~earlier.
    let h = head;
    if (tag === "T3End") { h = null; } // skip absolute for misaligned
    if (h === null) { console.log(`${tag.padEnd(12)} (misaligned, skip)`); continue; }
    const vals = [];
    for (let i = 0; i < 12; i++) vals.push(b.readUInt32LE(h + i * 4));
    console.log(`${tag.padEnd(12)} ` + vals.map(v => String(v).padStart(6)).join(""));
  }
}
