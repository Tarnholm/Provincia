// dig-diplomacy21.js — Filter isolated diffs to enum-like changes.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

const sz = Math.min(bA.length, bB.length);

const diffBits = new Uint8Array(sz);
for (let i = 0; i < sz; i++) if (bA[i] !== bB[i]) diffBits[i] = 1;

const isolated = [];
for (let i = 1; i < sz - 1; i++) {
  if (!diffBits[i]) continue;
  let nearby = 0;
  for (let j = Math.max(0, i - 16); j < Math.min(sz, i + 17); j++) {
    if (j === i) continue;
    if (diffBits[j]) nearby++;
  }
  if (nearby <= 1) {
    isolated.push(i);
  }
}
console.log(`Isolated diffs: ${isolated.length}`);

// Categorize:
const enumLike = [];   // both small (<8)
const counterLike = []; // both <100
const other = [];
for (const i of isolated) {
  const a = bA[i], b = bB[i];
  if (a <= 8 && b <= 8) enumLike.push({ i, a, b });
  else if (a < 100 && b < 100) counterLike.push({ i, a, b });
  else other.push({ i, a, b });
}
console.log(`Enum-like (both ≤8): ${enumLike.length}`);
console.log(`Counter-like (both <100): ${counterLike.length}`);
console.log(`Other: ${other.length}`);

// Print enum-like with hex context to spot patterns
console.log("\n=== Enum-like isolated diffs ===");
for (const e of enumLike) {
  const head = Array.from(bA.subarray(Math.max(0, e.i - 16), e.i)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  const tail = Array.from(bA.subarray(e.i + 1, e.i + 17)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log(`  0x${e.i.toString(16)}  A=${e.a} B=${e.b}  L:[${head}] X:[${e.a.toString(16).padStart(2,'0')}/${e.b.toString(16).padStart(2,'0')}] R:[${tail}]`);
}

console.log("\n=== Counter-like ===");
for (const e of counterLike.slice(0, 30)) {
  const head = Array.from(bA.subarray(Math.max(0, e.i - 16), e.i)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  const tail = Array.from(bA.subarray(e.i + 1, e.i + 17)).map(x => x.toString(16).padStart(2, '0')).join(' ');
  console.log(`  0x${e.i.toString(16)}  A=${e.a} B=${e.b}  L:[${head}] X R:[${tail}]`);
}
