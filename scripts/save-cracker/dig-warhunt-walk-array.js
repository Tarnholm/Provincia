// dig-warhunt-walk-array.js
// Walk the attitude-record array. Records appear to be ~0x70 bytes, each
// containing `<u32 X> 200 <u32 attitude> <u32 f1> <u32 f2> 185 ... trailer`.
// The record signature we can lock onto: the trailer `... 43 02 00 00 (=579)
// 00 00 00 00 ff ff ff ff 0e 00 00 00` OR the head `0d 00 00 00 c8 00 00 00`.
// Walk by searching for the head pattern and decode following fields. Compare
// pre vs war to see which records flip + their field values.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const pre = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 Start.sav");
const war = fs.readFileSync(SAVES_DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");

// The records seem to be embedded in a larger zero-padded array. We saw heads
// at 0x1183b, 0x11921, 0x117c8 etc. The reliable head is `c8 00 00 00 c8 00 00 00`
// preceded by some u32 and followed by `<2> <f2> <185>`. But pre-war the second
// c8 may be the attitude. Let's instead search for the TRAILER which is stable:
//   43 02 00 00 00 00 00 00 ff ff ff ff 0e 00 00 00   (579, 0, -1, 14)
// and walk backward to read attitude.
const TRAILER = Buffer.from([0x43,0x02,0x00,0x00, 0x00,0x00,0x00,0x00, 0xff,0xff,0xff,0xff, 0x0e,0x00,0x00,0x00]);

function findTrailers(buf, lo, hi) {
  const out = []; let p = lo;
  while ((p = buf.indexOf(TRAILER, p)) !== -1 && p < hi) { out.push(p); p += 1; }
  return out;
}

// Region of interest: 0x10000..0x20000 (the attitude block lives ~0x117xx-0x18xxx)
const lo = 0x10000, hi = 0x1a000;
const tPre = findTrailers(pre, lo, hi);
const tWar = findTrailers(war, lo, hi);
console.log(`trailers (579,0,-1,14) in 0x${lo.toString(16)}..0x${hi.toString(16)}: pre=${tPre.length} war=${tWar.length}`);
console.log("pre trailer offs:", tPre.map(o => "0x"+o.toString(16)).join(" "));

// For each trailer, the attitude field is some bytes before. From the dump the
// record head `<X> c8 c8 <2> <f2> 185` sits ~0x60 before the trailer. Let's
// print the 0x70 bytes preceding each trailer as u32 (byte-aligned to head).
function recBefore(buf, trailerOff) {
  // head appears ~0x60 before; find the nearest preceding `c8 00 00 00` that is
  // followed 4 bytes later by another u32 then `02 00 00 00`.
  for (let h = trailerOff - 0x20; h > trailerOff - 0x90; h--) {
    if (buf.readUInt32LE(h) === 200) {
      // candidate: head-1 field, attitude at h+4
      const att = buf.readUInt32LE(h + 4);
      const f1 = buf.readUInt32LE(h + 8);
      const f2 = buf.readUInt32LE(h + 12);
      const f3 = buf.readUInt32LE(h + 16);
      const keyBefore = buf.readUInt32LE(h - 4);
      if ((att === 200 || att === 600 || att === 400 || att === 100 || att === 0 || att === 850) && f1 <= 8) {
        return { headOff: h, keyBefore, base: 200, att, f1, f2, f3 };
      }
    }
  }
  return null;
}

console.log("\nRecord decode (key before head, attitude, f1, f2):");
for (const t of tPre) {
  const rp = recBefore(pre, t);
  const rw = recBefore(war, t);
  const ap = rp ? rp.att : "?";
  const aw = rw ? rw.att : "?";
  const flip = (ap !== aw) ? `  <<< ATT ${ap}->${aw}` : "";
  console.log(`trailer@0x${t.toString(16)} head@0x${(rp?rp.headOff:0).toString(16)} keyBefore=${rp?rp.keyBefore:"?"} att(pre)=${ap} att(war)=${aw} f1=${rp?rp.f1:"?"} f2=${rp?rp.f2:"?"}${flip}`);
}
