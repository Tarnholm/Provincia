// dig-battle13.js — Per-faction record: look at u32-aligned fields where the
// value changes by EXACTLY 1 between save_1 and save_3 (any record).

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

// Check Romans Julii (idx 0) specifically for any u32 that increased by 1
const baseA0 = recsA[0].pos + 52 + 4 * recsA[0].regions;
const baseB0 = recsB[0].pos + 52 + 4 * recsB[0].regions;
const MAX = 5000;
console.log("=== Romans Julii: u32 increased by 1 ===");
for (let k = 0; k + 4 < MAX; k += 4) {
  const a = bA.readUInt32LE(baseA0 + k);
  const b = bB.readUInt32LE(baseB0 + k);
  if (b - a === 1 && a < 1000 && b < 1000) {
    console.log(`  k=${k} (+post-regions, +52+4N+${k}): ${a}→${b}`);
  }
}
console.log("\n=== Romans Julii: u32 increased by 2..20 ===");
for (let k = 0; k + 4 < MAX; k += 4) {
  const a = bA.readUInt32LE(baseA0 + k);
  const b = bB.readUInt32LE(baseB0 + k);
  if (b - a >= 2 && b - a <= 20 && a < 1000 && b < 1000) {
    console.log(`  k=${k}: ${a}→${b} (Δ=${b-a})`);
  }
}

// Same for Messapians
const baseA20 = recsA[20].pos + 52 + 4 * recsA[20].regions;
const baseB20 = recsB[20].pos + 52 + 4 * recsB[20].regions;
console.log("\n=== Messapians: u32 increased by 1 ===");
for (let k = 0; k + 4 < MAX; k += 4) {
  const a = bA.readUInt32LE(baseA20 + k);
  const b = bB.readUInt32LE(baseB20 + k);
  if (b - a === 1 && a < 1000 && b < 1000) {
    console.log(`  k=${k}: ${a}→${b}`);
  }
}

console.log("\n=== Messapians: u32 changed (any) ===");
for (let k = 0; k + 4 < MAX; k += 4) {
  const a = bA.readUInt32LE(baseA20 + k);
  const b = bB.readUInt32LE(baseB20 + k);
  if (a !== b && a < 1000 && b < 1000) {
    console.log(`  k=${k}: ${a}→${b}`);
  }
}
