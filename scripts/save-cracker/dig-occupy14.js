// dig-occupy14.js
// Net file-size delta save_10.1 → save_12.1 is +143 bytes.
// Find where these 143 inserted bytes live (NOT in/around Uria record).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_10.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_12.1.sav"));

// Heuristic shift-tracking diff. Walk forward through both files; when bytes diverge,
// check if a small shift (1..maxShift bytes) realigns them.
const events = [];
let i = 0, j = 0;
const maxShift = 1024;
while (i < A.length && j < B.length) {
  if (A[i] === B[j]) { i++; j++; continue; }
  // Find next match in B[j..j+maxShift] for A[i..i+16]
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
  if (bestI < 0) {
    i++; j++;
    continue;
  }
  const skipA = bestI - i, skipB = bestJ - j;
  if (skipA === 0 && skipB > 0) {
    events.push({ kind: "INSERT", iA: i, jB: j, lenB: skipB, bytes: B.slice(j, j+Math.min(64, skipB)).toString("hex") });
  } else if (skipB === 0 && skipA > 0) {
    events.push({ kind: "DELETE", iA: i, jB: j, lenA: skipA, bytes: A.slice(i, i+Math.min(64, skipA)).toString("hex") });
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

console.log(`Events: ${events.length}`);
console.log(`  Inserts: ${inserts.length} (${totalInsBytes} bytes)`);
console.log(`  Deletes: ${deletes.length} (${totalDelBytes} bytes)`);
console.log(`  Replaces: ${replaces.length}`);
console.log(`  Net (ins-del): ${totalInsBytes - totalDelBytes}, expected: ${B.length - A.length}`);
console.log();

console.log("Significant inserts (>= 8 bytes):");
for (const e of inserts) {
  if (e.lenB < 8) continue;
  console.log(`  [INS@A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}] +${e.lenB} bytes: ${e.bytes}`);
}
console.log("Significant deletes (>= 8 bytes):");
for (const e of deletes) {
  if (e.lenA < 8) continue;
  console.log(`  [DEL@A0x${e.iA.toString(16)},B0x${e.jB.toString(16)}] -${e.lenA} bytes: ${e.bytes}`);
}
