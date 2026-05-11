// dig-alliance-deep4.js
// Cluster the 88K byte diffs in pre-matrix between save_2.1 and save_3.1.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

const MAT_START = 0xf8fd2;
const diffs = [];
for (let i = 0; i < MAT_START; i++) {
  if (A[i] !== B[i]) diffs.push(i);
}
console.log(`Total plain byte diffs in pre-matrix: ${diffs.length}`);

// Cluster diffs (gap > 16 = new cluster)
const runs = [];
let cs = null, ce = null;
const GAP = 64;
for (const d of diffs) {
  if (cs === null) { cs = d; ce = d; }
  else if (d - ce <= GAP) ce = d;
  else { runs.push([cs, ce]); cs = d; ce = d; }
}
if (cs !== null) runs.push([cs, ce]);

console.log(`Clusters (gap>${GAP}): ${runs.length}`);

// Sort by length, print top 30
const ranked = runs.map(([s, e]) => ({ s, e, len: e - s + 1 })).sort((a, b) => b.len - a.len);
console.log("\nTop 30 cluster sizes:");
for (const r of ranked.slice(0, 30)) {
  console.log(`  [0x${r.s.toString(16)}..0x${r.e.toString(16)}] len=${r.len}`);
}

console.log("\nAll clusters (cs..ce, len):");
for (const r of ranked) {
  console.log(`  [0x${r.s.toString(16)}..0x${r.e.toString(16)}] len=${r.len}`);
}
