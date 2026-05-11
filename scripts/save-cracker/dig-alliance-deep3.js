// dig-alliance-deep3.js
// Focused diff of save_2.1 vs save_3.1 in pre-matrix region [0..0xf8fd2] ONLY.
// Both saves have matrix start at 0xf8fd2 (verified).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

const MAT_START = 0xf8fd2;
const SEARCH_END = MAT_START; // pre-matrix only

console.log(`Diff pre-matrix [0..0x${MAT_START.toString(16)}] (${MAT_START.toLocaleString()} bytes)`);

// First, plain byte diff in this region
let plainDiffs = 0;
for (let i = 0; i < SEARCH_END; i++) {
  if (A[i] !== B[i]) plainDiffs++;
}
console.log(`Plain byte-by-byte diffs in pre-matrix: ${plainDiffs}`);

// Now shift-diff within pre-matrix only
const events = [];
let i = 0, j = 0;
const maxShift = 4096;
while (i < SEARCH_END && j < SEARCH_END) {
  if (A[i] === B[j]) { i++; j++; continue; }
  let bestI = -1, bestJ = -1, bestRun = 0;
  for (let dj = 1; dj < maxShift && j + dj + 32 < SEARCH_END; dj++) {
    let run = 0;
    while (i + run < SEARCH_END && j + dj + run < SEARCH_END && A[i+run] === B[j+dj+run] && run < 256) run++;
    if (run >= 32 && run > bestRun) { bestI = i; bestJ = j+dj; bestRun = run; break; }
  }
  for (let di = 1; di < maxShift && i + di + 32 < SEARCH_END; di++) {
    let run = 0;
    while (i + di + run < SEARCH_END && j + run < SEARCH_END && A[i+di+run] === B[j+run] && run < 256) run++;
    if (run >= 32 && run > bestRun) { bestI = i+di; bestJ = j; bestRun = run; break; }
  }
  if (bestI < 0) { i++; j++; continue; }
  const skipA = bestI - i, skipB = bestJ - j;
  if (skipA === 0 && skipB > 0) {
    events.push({ kind: "INSERT", iA: i, jB: j, len: skipB, bytes: B.slice(j, j + Math.min(96, skipB)).toString("hex") });
  } else if (skipB === 0 && skipA > 0) {
    events.push({ kind: "DELETE", iA: i, jB: j, len: skipA, bytes: A.slice(i, i + Math.min(96, skipA)).toString("hex") });
  } else {
    events.push({ kind: "REPLACE", iA: i, jB: j, lenA: skipA, lenB: skipB });
  }
  i = bestI; j = bestJ;
}

const inserts = events.filter(e => e.kind === "INSERT");
const deletes = events.filter(e => e.kind === "DELETE");
const replaces = events.filter(e => e.kind === "REPLACE");

console.log(`Events: ${events.length}`);
console.log(`  Inserts: ${inserts.length} (${inserts.reduce((s,e)=>s+e.len,0)} bytes)`);
console.log(`  Deletes: ${deletes.length} (${deletes.reduce((s,e)=>s+e.len,0)} bytes)`);
console.log(`  Replaces: ${replaces.length}`);
console.log(`  Net pre-matrix: ${inserts.reduce((s,e)=>s+e.len,0) - deletes.reduce((s,e)=>s+e.len,0)}`);

// Print insert/delete length distribution
console.log("\nInsert size buckets:");
const buckets = { "1-7": 0, "8-15": 0, "16-31": 0, "32-63": 0, "64-127": 0, "128-255": 0, "256-511": 0, "512+": 0 };
for (const e of inserts) {
  const len = e.len;
  if (len < 8) buckets["1-7"]++;
  else if (len < 16) buckets["8-15"]++;
  else if (len < 32) buckets["16-31"]++;
  else if (len < 64) buckets["32-63"]++;
  else if (len < 128) buckets["64-127"]++;
  else if (len < 256) buckets["128-255"]++;
  else if (len < 512) buckets["256-511"]++;
  else buckets["512+"]++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k}: ${v}`);

// Show small inserts (8-31 bytes)
console.log("\nVery small inserts (8-31 bytes):");
for (const e of inserts.filter(x => x.len >= 8 && x.len <= 31).slice(0, 50)) {
  console.log(`  [+${e.len}B @A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}]: ${e.bytes}`);
}

// Show small deletes
console.log("\nVery small deletes (8-31 bytes):");
for (const e of deletes.filter(x => x.len >= 8 && x.len <= 31).slice(0, 50)) {
  console.log(`  [-${e.len}B @A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}]: ${e.bytes}`);
}
