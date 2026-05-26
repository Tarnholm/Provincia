// dig-diploterms-13-playerzone.js
// Deep-dive the PLAYER (spain) own zone. The 4 entries are tag=0, class 5 att 5.
// Trade flipped one to class 2. Dump the full bytes of the spain zone + the
// preamble, and look at what immediately follows the entries (could be partner
// list / terms). Compare T1 vs T2(trade) vs T4(war) byte-for-byte for the zone.
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
    const fid = buf[i - 53];
    if (fid !== wantFid) continue;
    if (!best || best.count < count) best = { markerOff: i, count };
  }
  return best;
}

function hexrow(buf, off, len) {
  const s = [];
  for (let i = 0; i < len; i++) { if (off+i>=0 && off+i<buf.length) s.push(buf[off+i].toString(16).padStart(2,"0")); }
  return s.join(" ");
}

const files = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T2trade", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T4war", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
];

for (const [label, f] of files) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  const z = findZone(buf, 18); // spain
  const m = z.markerOff;
  const bodyLen = 8 + z.count * 16;
  console.log(`\n===== ${label} spain zone @0x${m.toString(16)} count=${z.count} =====`);
  // Print 64 bytes before marker + the whole zone body + 64 bytes after
  console.log(`  pre[-64..0]:`);
  console.log(`    ${hexrow(buf, m-64, 64)}`);
  console.log(`  zone body (marker + count + entries):`);
  for (let k = -8; k < bodyLen; k += 16) {
    console.log(`    +${(k).toString().padStart(3)}: ${hexrow(buf, m+k, 16)}`);
  }
  console.log(`  post[+${bodyLen}..+${bodyLen+96}]:`);
  for (let k = 0; k < 96; k += 16) console.log(`    ${hexrow(buf, m+bodyLen+k, 16)}`);
}
