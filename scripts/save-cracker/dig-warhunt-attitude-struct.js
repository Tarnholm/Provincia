// dig-warhunt-attitude-struct.js
// Decode the attitude-record structure at ~0x11900 and ~0x17bd0 in the Spain
// saves. The value c8(200)=NEUTRAL flips to 0258(600)=AT_WAR on declaring war.
// Goal: find the record stride and which u32 field identifies the partner
// faction (Carthage=7) so we can read "spain<->carthage = 600 (war)".
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const saves = {
  T4Start: "save_Autosave   Spain   Turn 4 Start.sav",
  declare: "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav",
  T4: "save_Autosave   Spain   Turn 4.sav",
};
const bufs = {}; for (const [k, f] of Object.entries(saves)) bufs[k] = fs.readFileSync(SAVES_DIR + f);

function u32row(buf, start, n) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(buf.readUInt32LE(start + i * 4));
  return arr;
}

for (const center of [0x118e0, 0x17bb0]) {
  console.log(`\n================ region around 0x${center.toString(16)} (u32 decode, 48 words) ================`);
  console.log("idx  off       T4Start      declareWAR   T4");
  for (let i = 0; i < 48; i++) {
    const o = center + i * 4;
    const a = bufs.T4Start.readUInt32LE(o);
    const b = bufs.declare.readUInt32LE(o);
    const c = bufs.T4.readUInt32LE(o);
    const mark = (a !== b) ? "  <<< CHANGED" : "";
    console.log(`${String(i).padStart(3)}  0x${o.toString(16)}  ${String(a).padStart(10)}  ${String(b).padStart(10)}  ${String(c).padStart(10)}${mark}`);
  }
}
