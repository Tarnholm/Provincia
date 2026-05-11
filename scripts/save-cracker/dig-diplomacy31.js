// dig-diplomacy31.js — Investigate K=1832 area in Messapians record more carefully.
// Also look for ONLY-Romans-Julii or ONLY-Messapians-Julii indicators in trailing data.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

function findMajor(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
    i += 60;
  }
  return out;
}

const recsA = findMajor(bA);
const recsB = findMajor(bB);

// Inspect Messapians K=1820..1880
const baseA20 = recsA[20].pos + 52 + 4 * recsA[20].regions;
const baseB20 = recsB[20].pos + 52 + 4 * recsB[20].regions;

console.log("=== Messapians K=1820..1880 ===");
for (let k = 1820; k < 1880; k += 16) {
  const rowA = [], rowB = [];
  for (let j = 0; j < 16 && k + j < 1880; j++) {
    rowA.push(bA[baseA20 + k + j].toString(16).padStart(2, '0'));
    rowB.push(bB[baseB20 + k + j].toString(16).padStart(2, '0'));
  }
  console.log(`  k=${k}: A: ${rowA.join(' ')}`);
  console.log(`  k=${k}: B: ${rowB.join(' ')}`);
}

// Now check Messapians + Romans: K=1832 went 1→0 for Messap. Is this the ONLY decrement?
// Maybe the Roman record has a similar field that went 0→1?
const baseA0 = recsA[0].pos + 52 + 4 * recsA[0].regions;
const baseB0 = recsB[0].pos + 52 + 4 * recsB[0].regions;

console.log("\n=== Romans Julii K=1820..1880 ===");
for (let k = 1820; k < 1880; k += 16) {
  const rowA = [], rowB = [];
  for (let j = 0; j < 16 && k + j < 1880; j++) {
    rowA.push(bA[baseA0 + k + j].toString(16).padStart(2, '0'));
    rowB.push(bB[baseB0 + k + j].toString(16).padStart(2, '0'));
  }
  console.log(`  k=${k}: A: ${rowA.join(' ')}`);
  console.log(`  k=${k}: B: ${rowB.join(' ')}`);
}

// Find Messapians' diffs in K=1000..3000 region (post all character/portrait data)
console.log("\n=== Messapians diffs in K=1000..3000 ===");
for (let k = 1000; k < 3000; k++) {
  const a = bA[baseA20 + k];
  const b = bB[baseB20 + k];
  if (a === b) continue;
  // Only show "clean" diffs (both <=10)
  if (a > 10 || b > 10) continue;
  console.log(`  k=${k}: A=${a} B=${b}  ctx: ${Array.from(bA.subarray(baseA20+k-4, baseA20+k+5)).map(x=>x.toString(16).padStart(2,'0')).join(' ')}`);
}
console.log("\n=== Romans Julii diffs in K=1000..3000 (clean) ===");
for (let k = 1000; k < 3000; k++) {
  const a = bA[baseA0 + k];
  const b = bB[baseB0 + k];
  if (a === b) continue;
  if (a > 10 || b > 10) continue;
  console.log(`  k=${k}: A=${a} B=${b}  ctx: ${Array.from(bA.subarray(baseA0+k-4, baseA0+k+5)).map(x=>x.toString(16).padStart(2,'0')).join(' ')}`);
}
