// dig-warhunt-array-bounds.js
// Find the attitude-record array bounds + stride, and look for the section
// header (count) just before the first record. The head pattern is
// `c8 00 00 00 <DS> 00 00 00` (base=200, attitude DS). Find the first and last,
// compute spacing, and dump the bytes just before the first record.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(SAVES_DIR + (process.argv[2] || "save_Autosave   Spain   Turn 4 Start.sav"));
const DS = new Set([0,100,200,400,600,850,1000]);
const heads = [];
for (let o = 0x6000; o + 8 <= 0x1a000; o++) {
  if (buf.readUInt32LE(o) === 200 && DS.has(buf.readUInt32LE(o + 4))) heads.push(o);
}
console.log(`heads: ${heads.length}, first=0x${heads[0].toString(16)} last=0x${heads[heads.length-1].toString(16)}`);
// spacing histogram
const sp = {};
for (let i = 1; i < heads.length; i++) { const d = heads[i] - heads[i-1]; sp[d] = (sp[d]||0)+1; }
console.log("spacing histogram:", JSON.stringify(sp));
// bytes before first record
const f = heads[0];
function dump(start, len) {
  let s = "";
  for (let r = 0; r < len; r += 16) {
    const o = start + r; const sl = buf.slice(o, o + 16);
    const hex = Array.from(sl).map(x => x.toString(16).padStart(2, "0")).join(" ");
    const u = []; for (let j = 0; j + 4 <= sl.length; j += 4) u.push(sl.readUInt32LE(j));
    s += "0x" + o.toString(16) + "  " + hex + "  [" + u.join(",") + "]\n";
  }
  return s;
}
console.log(`\nbytes before first record (0x${(f-0x60).toString(16)}):`);
console.log(dump(f - 0x60, 0x80));
