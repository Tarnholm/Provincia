// dig-diploterms-14-stancematrix.js
// Hunt for a faction-vs-faction STANCE matrix that flips on war. Approach:
// the diplomacy zone preamble has a revision counter that ticks on each diplo
// action. The actual stance must live in a structure near the faction records.
// Strategy: the zone body is followed by faction-record continuation. Walk a
// window after each zone and look for a per-faction stance array.
//
// Also: dump the bytes around the spain zone in WIDER context to find any
// 21-length array (one entry per faction).
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const MARKER = 0x39240005;

function findZone(buf, wantFid) {
  let best = null;
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    if (buf[i - 53] !== wantFid) continue;
    if (!best || best.count < count) best = { markerOff: i, count };
  }
  return best;
}

function hexrow(buf, off, len) {
  const s = [];
  for (let i = 0; i < len; i++) { if (off+i>=0 && off+i<buf.length) s.push(buf[off+i].toString(16).padStart(2,"0")); }
  return s.join(" ");
}

// Wide dump after the spain zone for all 3 saves to find a per-faction array.
const files = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T4war", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
];

for (const [label, f] of files) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  const z = findZone(buf, 18);
  const start = z.markerOff + 8 + z.count * 16;
  console.log(`\n===== ${label}: 320 bytes after spain zone body (@0x${start.toString(16)}) =====`);
  for (let k = 0; k < 320; k += 16) {
    console.log(`  +${k.toString().padStart(3)}: ${hexrow(buf, start+k, 16)}`);
  }
}
