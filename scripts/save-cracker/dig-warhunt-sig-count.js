// dig-warhunt-sig-count.js
// Use the FULL record signature to isolate true diplomacy attitude records.
// Spain war record (byte-aligned from key):
//   +0  key (u8 value 13 or 10, then 00 00 00)
//   +4  base = 200
//   +8  attitude (DS)
//   +c  flag (0,1,2)
//   +10 counter
//   ... +0x40 trailer 43 02 00 00 00 00 00 00 ff ff ff ff 0e 00 00 00
// The DISTINCTIVE part: base=200 immediately followed by attitude, AND 0x38
// bytes later (+0x40) the `43 02 00 00` (579) ... `ff ff ff ff 0e 00 00 00`.
// Count records matching this full signature, by attitude.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const DS = new Set([0, 100, 200, 400, 600, 850, 1000]);

function countSig(buf) {
  // For each base=200 head, verify the trailer `579,0,-1,14` lies at head+0x3c
  // (relative to base) — calibrate from Spain: base@0x11925, trailer@0x11969 =>
  // delta 0x44. Let's check delta 0x44 (trailer 579 at base+0x44).
  const hist = {};
  const recs = [];
  for (let o = 0x4000; o + 0x54 <= buf.length; o++) {
    if (buf.readUInt32LE(o) !== 200) continue;       // base
    const att = buf.readUInt32LE(o + 4);
    if (!DS.has(att)) continue;
    // trailer check at o+0x44
    const tr = o + 0x44;
    if (buf.readUInt32LE(tr) !== 579) continue;
    if (buf.readUInt32LE(tr + 4) !== 0) continue;
    if (buf.readUInt32LE(tr + 8) !== 0xffffffff) continue;
    if (buf.readUInt32LE(tr + 12) !== 14) continue;
    hist[att] = (hist[att] || 0) + 1;
    recs.push({ o, att });
  }
  return { hist, recs };
}

for (const f of ["save_Autosave   Spain   Turn 4 Start.sav",
                 "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav",
                 "save_macedon t0.sav", "save_Seleucids t0.sav"]) {
  const buf = fs.readFileSync(SAVES_DIR + f);
  const { hist, recs } = countSig(buf);
  console.log(`${f}`);
  console.log(`  full-signature records: ${recs.length}  histogram: ${JSON.stringify(hist)}  att600=${hist[600]||0}`);
}
