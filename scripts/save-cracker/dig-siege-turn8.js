// dig-siege-turn8.js
// Same analysis for save_8 (Tarentum siege) → save_9 (siege stopped, -73 bytes).

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_8.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_9.1.sav"));

console.log(`A=${A.length}, B=${B.length}, diff=${B.length - A.length}`);

let i = 0, j = 0;
let shifts = [];
while (i < A.length && j < B.length) {
  let run = 0;
  while (i + run < A.length && j + run < B.length && A[i+run] === B[j+run]) run++;
  if (run >= 8) {
    i += run; j += run;
    continue;
  }
  let best = null;
  for (let dj = 1; dj < 256 && j + dj + 64 < B.length; dj++) {
    let r = 0;
    while (i + r < A.length && j + dj + r < B.length && A[i+r] === B[j+dj+r]) r++;
    if (r >= 64) {
      shifts.push({ kind: "INS_B", iA: i, jB: j, len: dj });
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
        shifts.push({ kind: "DEL_A", iA: i, jB: j, len: di });
        i += di;
        best = { di };
        break;
      }
    }
  }
  if (!best) { i++; j++; }
}

let totalIns = 0, totalDel = 0;
for (const s of shifts) {
  if (s.kind === "INS_B") totalIns += s.len;
  else totalDel += s.len;
}
console.log(`Shifts: ${shifts.length}, +${totalIns} -${totalDel} net=${totalIns - totalDel}`);

console.log("\nAll shifts (save_8 → save_9, siege STOP):");
for (const s of shifts) {
  let bytes = "";
  if (s.kind === "INS_B") bytes = B.slice(s.jB, s.jB + Math.min(80, s.len)).toString("hex");
  else bytes = A.slice(s.iA, s.iA + Math.min(80, s.len)).toString("hex");
  console.log(`  ${s.kind} A0x${s.iA.toString(16)} B0x${s.jB.toString(16)} len=${s.len}: ${bytes}`);
}
