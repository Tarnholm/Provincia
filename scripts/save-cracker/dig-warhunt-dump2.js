"use strict";
const fs = require("fs");
const D = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const a = fs.readFileSync(D + "save_Autosave   Spain   Turn 4 Start.sav");
const b = fs.readFileSync(D + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
function dump(buf, start, len) {
  let s = "";
  for (let r = 0; r < len; r += 16) {
    const o = start + r; const sl = buf.slice(o, o + 16);
    const hex = Array.from(sl).map(x => x.toString(16).padStart(2, "0")).join(" ");
    const u = []; for (let j = 0; j + 4 <= sl.length; j += 4) u.push(sl.readUInt32LE(j));
    s += "0x" + o.toString(16) + "  " + hex + "  [" + u.join(",") + "]\n";
  }
  return s;
}
const start = parseInt(process.argv[2] || "11988", 16);
const len = parseInt(process.argv[3] || "0x80", 16);
console.log("=== T4Start ===");
console.log(dump(a, start, len));
console.log("=== declareWAR ===");
console.log(dump(b, start, len));
