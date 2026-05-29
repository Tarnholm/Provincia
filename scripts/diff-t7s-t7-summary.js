"use strict";
// Summarize the differences between T7-Start autosave and T7-manual save.
// These are the bytes player actions during T7 changed.
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Republic of Rome   Turn 7 Start.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_Julii turn7.sav"));
const len = Math.min(A.length, B.length);

let diffs = 0;
const ranges = []; // contiguous diff runs
let runStart = -1;
for (let i = 0; i < len; i++) {
  if (A[i] !== B[i]) {
    diffs++;
    if (runStart < 0) runStart = i;
  } else if (runStart >= 0) {
    ranges.push({ start: runStart, end: i - 1, len: i - runStart });
    runStart = -1;
  }
}
if (runStart >= 0) ranges.push({ start: runStart, end: len - 1, len: len - runStart });

console.log(`total diff bytes: ${diffs}  total diff runs: ${ranges.length}`);
console.log("\nTop 20 longest diff runs:");
ranges.sort((a, b) => b.len - a.len);
for (const r of ranges.slice(0, 20)) {
  const a4 = A.length >= r.start + 4 ? A.readUInt32LE(r.start) : 0;
  const b4 = B.length >= r.start + 4 ? B.readUInt32LE(r.start) : 0;
  console.log(`  ${r.start}..${r.end} (${r.len} bytes)  A=0x${a4.toString(16)} B=0x${b4.toString(16)}`);
}

console.log("\nFirst 20 diff offsets (sorted by position):");
ranges.sort((a, b) => a.start - b.start);
for (const r of ranges.slice(0, 20)) {
  const a4 = A.length >= r.start + 4 ? A.readUInt32LE(r.start) : 0;
  const b4 = B.length >= r.start + 4 ? B.readUInt32LE(r.start) : 0;
  console.log(`  off=${r.start} len=${r.len}  A=${a4} (${A[r.start].toString(16)}..) B=${b4} (${B[r.start].toString(16)}..)`);
}
