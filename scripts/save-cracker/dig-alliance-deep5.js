// dig-alliance-deep5.js
// Examine the medium-sized clusters (60-300 byte range) in pre-matrix save_2.1 vs save_3.1
// to see which might represent an alliance entry being added.

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

const runs = [];
let cs = null, ce = null;
const GAP = 64;
for (const d of diffs) {
  if (cs === null) { cs = d; ce = d; }
  else if (d - ce <= GAP) ce = d;
  else { runs.push([cs, ce]); cs = d; ce = d; }
}
if (cs !== null) runs.push([cs, ce]);

const midClusters = runs.map(([s, e]) => ({ s, e, len: e - s + 1 }))
                        .filter(r => r.len >= 60 && r.len <= 400)
                        .sort((a, b) => b.len - a.len);

console.log(`Mid-sized clusters (60-400 B): ${midClusters.length}`);

// For each, print A and B context (32 B before, the cluster, 16 B after)
for (let i = 0; i < Math.min(20, midClusters.length); i++) {
  const r = midClusters[i];
  console.log(`\n=== Cluster #${i+1} [0x${r.s.toString(16)}..0x${r.e.toString(16)}] len=${r.len} ===`);
  const before = 16;
  const after = 16;
  const start = Math.max(0, r.s - before);
  const end = Math.min(MAT_START, r.e + 1 + after);
  console.log(`A: ${A.slice(start, end).toString("hex")}`);
  console.log(`B: ${B.slice(start, end).toString("hex")}`);
  // Decode interesting u32 fields
  const aU32 = []; const bU32 = [];
  for (let k = 0; k + 4 <= r.len; k += 4) {
    aU32.push(A.readUInt32LE(r.s + k));
    bU32.push(B.readUInt32LE(r.s + k));
  }
  // Find positions where aU32[k] === bU32[k] (no diff at this 4-byte boundary)
  console.log(`u32s (alignment guess): A=[${aU32.slice(0,20).join(",")}], B=[${bU32.slice(0,20).join(",")}]`);
}
