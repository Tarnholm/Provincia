// dig-warhunt-attitude-scan.js
// Find ALL attitude records. Pattern: the live attitude field is a u32 holding
// one of the DS values {0,100,200,400,600,850,1000} (or near). In the Spain
// declareWAR save a record's attitude went 200->600. Search the WHOLE file for
// the byte sequence `<200><200>` and `<200><600>` aligned, and report counts +
// offsets across pre/war saves to see which records flipped.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

const files = {
  T2: "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav",
  T3End: "save_Autosave   Spain   Turn 3 End.sav",
  T4Start: "save_Autosave   Spain   Turn 4 Start.sav",
  declare: "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav",
  besieged: "save_Autosave   Spain   Turn 4 besiged .sav",
  T4: "save_Autosave   Spain   Turn 4.sav",
};

// count occurrences of a 4-byte LE value followed immediately by another 4-byte LE value
function countSeq(buf, v1, v2) {
  const t = Buffer.alloc(8); t.writeUInt32LE(v1 >>> 0, 0); t.writeUInt32LE(v2 >>> 0, 4);
  const offs = []; let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) { offs.push(p); p += 1; }
  return offs;
}

for (const [tag, f] of Object.entries(files)) {
  let buf; try { buf = fs.readFileSync(SAVES_DIR + f); } catch { continue; }
  const neut = countSeq(buf, 200, 200);   // 200,200
  const war = countSeq(buf, 200, 600);    // 200,600
  const war2 = countSeq(buf, 600, 200);   // 600,200 (reversed pair)
  const ww = countSeq(buf, 600, 600);     // 600,600
  console.log(`${tag.padEnd(10)} <200,200>=${neut.length}  <200,600>=${war.length} @[${war.map(o=>"0x"+o.toString(16)).join(",")}]  <600,200>=${war2.length}  <600,600>=${ww.length}`);
}
