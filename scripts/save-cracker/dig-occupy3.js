// dig-occupy3.js
// Compare save_11.1 (Brundisium captured, Uria still occupied) vs save_12.1 (exterminate Uria).
// Saves have DIFFERENT total sizes — save_11.1 is the Brundisium-captured intermediate state.
// Uria marker:
//   save_11.1: 0x12693c6
//   save_12.1: 0x1264861

// First step: align by Uria marker offset, diff the record region around each.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_11.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_12.1.sav"));

const MA = 0x12693c6;
const MB = 0x1264861;

console.log(`save_11.1 marker offset 0x${MA.toString(16)}, save_12.1 marker offset 0x${MB.toString(16)}`);
console.log(`A=${A.length}, B=${B.length}, diff=${B.length - A.length}`);

console.log(`\nMarker context A[MA-30..MA+30]:`);
console.log("A:", A.slice(MA - 30, MA + 30).toString("hex"));
console.log(`Marker context B[MB-30..MB+30]:`);
console.log("B:", B.slice(MB - 30, MB + 30).toString("hex"));

// Align by marker offset; diff Uria[-200..+5000] relative to its own marker.
console.log(`\nByte diff in Uria record region (offset from marker -200..+5000):`);
const diffs = [];
for (let off = -200; off < 5000; off++) {
  if (A[MA + off] !== B[MB + off]) diffs.push(off);
}
console.log(`Total byte diffs: ${diffs.length}`);

// Cluster
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
  const sgn = s >= 0 ? "+" : "";
  const aHex = A.slice(MA + s, MA + e + 1).toString("hex");
  const bHex = B.slice(MB + s, MB + e + 1).toString("hex");
  console.log(`  off Uria${sgn}${s}, len=${e - s + 1}: A=${aHex}  B=${bHex}`);
}
