// dig-siege-turn6.js
// save_6 has no siege. save_7 has Brundisium siege block inserted (file +73 bytes).
// Find EXACTLY where the 73 bytes were inserted.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_6.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_7.1.sav"));

console.log(`A=${A.length}, B=${B.length}, diff=${B.length - A.length}`);

// First byte that differs (forward)
let firstDiff = -1;
const minLen = Math.min(A.length, B.length);
for (let i = 0; i < minLen; i++) {
  if (A[i] !== B[i]) { firstDiff = i; break; }
}
console.log(`First forward diff: 0x${firstDiff.toString(16)}`);

// Last byte that differs (backward — looking from end of each)
let lastDiff = -1;
for (let i = 0; i < minLen; i++) {
  if (A[A.length - 1 - i] !== B[B.length - 1 - i]) { lastDiff = i; break; }
}
console.log(`Last reverse diff: ${lastDiff} bytes from end`);
console.log(`  In A: 0x${(A.length - 1 - lastDiff).toString(16)}`);
console.log(`  In B: 0x${(B.length - 1 - lastDiff).toString(16)}`);

// Walk forward and find where the shift happens
let i = 0, j = 0;
while (i < A.length && j < B.length) {
  if (A[i] === B[j]) { i++; j++; continue; }
  console.log(`Shift detected at A 0x${i.toString(16)}, B 0x${j.toString(16)}`);
  // Try shifting B forward by exactly 73 (the file size delta)
  if (j + 73 < B.length && A[i] === B[j + 73]) {
    console.log(`  B shifts +73 here. Inserted block in B at 0x${j.toString(16)}..0x${(j+73).toString(16)}`);
    console.log(`  Inserted bytes: ${B.slice(j, j + 73).toString("hex")}`);
    j += 73;
  } else {
    // Try other shifts
    for (let dj = 1; dj < 200; dj++) {
      if (A[i] === B[j + dj]) {
        let run = 0;
        while (i + run < A.length && j + dj + run < B.length && A[i+run] === B[j+dj+run]) run++;
        if (run > 64) {
          console.log(`  B shifts +${dj}. Inserted ${dj} bytes at B 0x${j.toString(16)}: ${B.slice(j, j+Math.min(dj, 128)).toString("hex")}`);
          j += dj;
          break;
        }
      }
    }
    if (A[i] !== B[j]) { i++; j++; }
  }
}
