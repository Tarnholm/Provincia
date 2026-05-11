// dig-alliance-deep1.js
// Find alliance state between save_2.1 (trade rights w/ Mess) and save_3.1 (+alliance w/ Mess).
// MASK OUT the diplomacy matrix region (0xf8fd2 + 239*239*267 bytes).
// Net file size change: +166 KB.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

console.log(`A=${A.length}, B=${B.length}, diff=${B.length - A.length}`);

const MAT_START = 0xf8fd2;
const MAT_END = MAT_START + 239 * 239 * 267;  // = 0x1ed64b5
console.log(`Matrix region: 0x${MAT_START.toString(16)}..0x${MAT_END.toString(16)} (${(MAT_END-MAT_START).toLocaleString()} bytes)`);

// Shift-tracking diff with the matrix region masked.
// Walk forward; if both i,j fall inside [MAT_START, MAT_END], skip ahead by max(both gaps).
const events = [];
let i = 0, j = 0;
const maxShift = 4096;
while (i < A.length && j < B.length) {
  // Skip matrix region entirely
  if (i >= MAT_START && i < MAT_END && j >= MAT_START && j < MAT_END) {
    const skipA = MAT_END - i, skipB = MAT_END - j;
    const skip = Math.min(skipA, skipB);
    i += skip; j += skip;
    continue;
  }
  if (A[i] === B[j]) { i++; j++; continue; }
  // Find next match
  let bestI = -1, bestJ = -1, bestRun = 0;
  for (let dj = 1; dj < maxShift && j + dj + 16 < B.length; dj++) {
    let run = 0;
    while (i + run < A.length && j + dj + run < B.length && A[i+run] === B[j+dj+run] && run < 256) run++;
    if (run >= 16 && run > bestRun) { bestI = i; bestJ = j+dj; bestRun = run; break; }
  }
  for (let di = 1; di < maxShift && i + di + 16 < A.length; di++) {
    let run = 0;
    while (i + di + run < A.length && j + run < B.length && A[i+di+run] === B[j+run] && run < 256) run++;
    if (run >= 16 && run > bestRun) { bestI = i+di; bestJ = j; bestRun = run; break; }
  }
  if (bestI < 0) { i++; j++; continue; }
  const skipA = bestI - i, skipB = bestJ - j;
  if (skipA === 0 && skipB > 0) {
    events.push({ kind: "INSERT", iA: i, jB: j, lenB: skipB, bytes: B.slice(j, j + Math.min(96, skipB)).toString("hex") });
  } else if (skipB === 0 && skipA > 0) {
    events.push({ kind: "DELETE", iA: i, jB: j, lenA: skipA, bytes: A.slice(i, i + Math.min(96, skipA)).toString("hex") });
  } else {
    events.push({ kind: "REPLACE", iA: i, jB: j, lenA: skipA, lenB: skipB });
  }
  i = bestI; j = bestJ;
}

const inserts = events.filter(e => e.kind === "INSERT");
const deletes = events.filter(e => e.kind === "DELETE");
const replaces = events.filter(e => e.kind === "REPLACE");

const totalInsBytes = inserts.reduce((s, e) => s + e.lenB, 0);
const totalDelBytes = deletes.reduce((s, e) => s + e.lenA, 0);

console.log(`\nEvents (matrix region masked): ${events.length}`);
console.log(`  Inserts: ${inserts.length} (${totalInsBytes} bytes)`);
console.log(`  Deletes: ${deletes.length} (${totalDelBytes} bytes)`);
console.log(`  Replaces: ${replaces.length}`);
console.log(`  Net (ins-del) outside matrix: ${totalInsBytes - totalDelBytes}, expected total: ${B.length - A.length}`);

// Print significant inserts BEFORE the matrix and AFTER the matrix
console.log("\n=== Inserts BEFORE matrix (offset < 0xf8fd2) ===");
let count = 0;
for (const e of inserts) {
  if (e.iA >= MAT_START) continue;
  if (e.lenB < 8) continue;
  count++;
  if (count > 30) break;
  console.log(`  [INS@A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}] +${e.lenB} bytes: ${e.bytes.slice(0, 192)}`);
}

console.log("\n=== Inserts AFTER matrix (offset >= 0x1ed64b5) ===");
count = 0;
for (const e of inserts) {
  if (e.iA < MAT_END) continue;
  if (e.lenB < 8) continue;
  count++;
  if (count > 30) break;
  console.log(`  [INS@A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}] +${e.lenB} bytes: ${e.bytes.slice(0, 192)}`);
}

console.log("\n=== Deletes BEFORE matrix ===");
count = 0;
for (const e of deletes) {
  if (e.iA >= MAT_START) continue;
  if (e.lenA < 8) continue;
  count++;
  if (count > 30) break;
  console.log(`  [DEL@A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}] -${e.lenA} bytes: ${e.bytes.slice(0, 192)}`);
}

console.log("\n=== Deletes AFTER matrix ===");
count = 0;
for (const e of deletes) {
  if (e.iA < MAT_END) continue;
  if (e.lenA < 8) continue;
  count++;
  if (count > 30) break;
  console.log(`  [DEL@A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}] -${e.lenA} bytes: ${e.bytes.slice(0, 192)}`);
}
