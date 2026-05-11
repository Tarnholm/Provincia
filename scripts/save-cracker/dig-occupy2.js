// dig-occupy2.js
// Byte-level diff of Uria settlement record between save_9.1 (pre) and save_10.1 (enslave).
// Both saves have Uria at offset 0x1264861. The record extends back (before the marker) and forward.
// Settlement record signature: -21 = 0xcb, +28 = owner-turn-tag, etc per brief.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_9.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_10.1.sav"));

console.log(`A=${A.length}, B=${B.length}, diff=${B.length - A.length}`);

// Uria marker at 0x1264861. Record extends back and forward.
// Per brief, record signature has -21 = 0xcb.
// Let's scan -200 before to +5000 after.

const MARKER = 0x1264861;
const START = MARKER - 200;
const END = MARKER + 5000;

console.log(`\nMarker context A[MARKER-30..MARKER+30]:`);
console.log("A:", A.slice(MARKER - 30, MARKER + 30).toString("hex"));
console.log("B:", B.slice(MARKER - 30, MARKER + 30).toString("hex"));

console.log(`\nByte-level diff in [0x${START.toString(16)}, 0x${END.toString(16)}]:`);
const diffs = [];
for (let i = START; i < END && i < A.length && i < B.length; i++) {
  if (A[i] !== B[i]) diffs.push(i);
}
console.log(`Total byte diffs: ${diffs.length}`);

// Cluster diffs into runs of consecutive bytes (or near-consecutive)
const runs = [];
let curStart = null, curEnd = null;
for (const d of diffs) {
  if (curStart === null) {
    curStart = d; curEnd = d;
  } else if (d - curEnd <= 4) {
    curEnd = d;
  } else {
    runs.push([curStart, curEnd]);
    curStart = d; curEnd = d;
  }
}
if (curStart !== null) runs.push([curStart, curEnd]);

console.log(`\n${runs.length} runs:`);
for (const [s, e] of runs) {
  const off = s - MARKER;
  const sgn = off >= 0 ? "+" : "";
  const aHex = A.slice(s, e + 1).toString("hex");
  const bHex = B.slice(s, e + 1).toString("hex");
  console.log(`  off 0x${s.toString(16)} (Uria${sgn}${off}), len=${e-s+1}: A=${aHex}  B=${bHex}`);
}
