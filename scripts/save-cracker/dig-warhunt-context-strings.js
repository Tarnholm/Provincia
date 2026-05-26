// dig-warhunt-context-strings.js
// What is the array at 0x10000-0x1a000? Find the nearest ASCII strings (pstr16
// or pstr8) before/after a given offset to identify the structure (settlement?
// faction? region?). Also locate the array's start by scanning backward for a
// section header.
"use strict";
const fs = require("fs");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(SAVES_DIR + (process.argv[2] || "save_Autosave   Spain   Turn 4 Start.sav"));

// Find all ASCII runs (>=4 printable) in a region
const lo = parseInt(process.argv[3] || "0xf000", 16);
const hi = parseInt(process.argv[4] || "0x1b000", 16);
let run = ""; let runStart = -1;
const strings = [];
for (let o = lo; o < hi; o++) {
  const b = buf[o];
  if (b >= 0x20 && b < 0x7f) {
    if (runStart < 0) runStart = o;
    run += String.fromCharCode(b);
  } else {
    if (run.length >= 4) strings.push({ at: runStart, s: run });
    run = ""; runStart = -1;
  }
}
console.log(`ASCII strings in 0x${lo.toString(16)}..0x${hi.toString(16)}: ${strings.length}`);
for (const s of strings.slice(0, 60)) console.log(`  0x${s.at.toString(16)}  "${s.s}"`);
