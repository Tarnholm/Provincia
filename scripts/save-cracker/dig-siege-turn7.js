// dig-siege-turn7.js
// Use a high-threshold shift-diff to find the actual 73-byte insertion in save_6 → save_7.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_6.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_7.1.sav"));

// Walk in chunks. After matching segment >=64 bytes, look at where the next shift happens.
let i = 0, j = 0;
let shifts = [];
let currentShift = 0;
while (i < A.length && j < B.length) {
  // Find max matching run starting here
  let run = 0;
  while (i + run < A.length && j + run < B.length && A[i+run] === B[j+run]) run++;
  if (run >= 8) {
    i += run; j += run;
    continue;
  }
  // Try to find shift back to alignment
  let best = null;
  for (let dj = 1; dj < 256 && j + dj + 64 < B.length; dj++) {
    let r = 0;
    while (i + r < A.length && j + dj + r < B.length && A[i+r] === B[j+dj+r]) r++;
    if (r >= 64) {
      // B inserted dj bytes
      shifts.push({ kind: "INS_B", iA: i, jB: j, len: dj, oldShift: currentShift, newShift: currentShift + dj });
      currentShift += dj;
      j += dj;
      best = { dj };
      break;
    }
  }
  if (!best) {
    for (let di = 1; di < 256 && i + di + 64 < A.length; di++) {
      let r = 0;
      while (i + di + r < A.length && j + r < B.length && A[i+di+r] === B[j+r]) r++;
      if (r >= 64) {
        shifts.push({ kind: "DEL_A", iA: i, jB: j, len: di, oldShift: currentShift, newShift: currentShift - di });
        currentShift -= di;
        i += di;
        best = { di };
        break;
      }
    }
  }
  if (!best) { i++; j++; }
}

console.log(`Shifts: ${shifts.length}`);
let totalIns = 0, totalDel = 0;
for (const s of shifts) {
  if (s.kind === "INS_B") totalIns += s.len;
  else totalDel += s.len;
}
console.log(`Total inserts: ${totalIns}, total deletes: ${totalDel}, net: ${totalIns - totalDel}`);

console.log("\nAll shifts:");
for (const s of shifts) {
  let bytes = "";
  if (s.kind === "INS_B") bytes = B.slice(s.jB, s.jB + Math.min(80, s.len)).toString("hex");
  else bytes = A.slice(s.iA, s.iA + Math.min(80, s.len)).toString("hex");
  console.log(`  ${s.kind} A0x${s.iA.toString(16)} B0x${s.jB.toString(16)} len=${s.len}: ${bytes}`);
}
