// dig-occupy11.js
// Direct comparison: save_10.1 (enslave Uria) vs save_12.1 (exterminate Uria).
// Both have Uria at 0x1264861. Find the bytes that distinguish these two action choices.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_10.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_12.1.sav"));

console.log(`A=${A.length}, B=${B.length}, diff=${B.length - A.length}`);

const MARKER = 0x1264861;

// Wide range Uria diff
const RANGE = [-5000, 10000];
const diffs = [];
for (let off = RANGE[0]; off < RANGE[1]; off++) {
  if (A[MARKER + off] !== B[MARKER + off]) diffs.push(off);
}
console.log(`Total byte diffs around Uria: ${diffs.length}`);

const runs = [];
let cs = null, ce = null;
for (const d of diffs) {
  if (cs === null) { cs = d; ce = d; }
  else if (d - ce <= 4) ce = d;
  else { runs.push([cs, ce]); cs = d; ce = d; }
}
if (cs !== null) runs.push([cs, ce]);

console.log(`\n${runs.length} runs that differ between ENSLAVE and EXTERMINATE:`);
for (const [s, e] of runs) {
  const aHex = A.slice(MARKER + s, MARKER + e + 1).toString("hex");
  const bHex = B.slice(MARKER + s, MARKER + e + 1).toString("hex");
  console.log(`  Uria${s >= 0 ? "+" : ""}${s} (abs 0x${(MARKER+s).toString(16)}), len=${e-s+1}:`);
  console.log(`    enslave:     ${aHex}`);
  console.log(`    exterminate: ${bHex}`);
}
