// dig-diplomacy29.js — Inspect a wider context around the K=821 region.

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

const ROMAN = 0, MESS = 20;
const baseA0 = recsA[ROMAN].pos + 52 + 4 * recsA[ROMAN].regions;
const baseB0 = recsB[ROMAN].pos + 52 + 4 * recsB[ROMAN].regions;
const baseA20 = recsA[MESS].pos + 52 + 4 * recsA[MESS].regions;
const baseB20 = recsB[MESS].pos + 52 + 4 * recsB[MESS].regions;

function dumpRange(buf, base, kStart, kEnd, label) {
  console.log(`\n${label} (base=0x${base.toString(16)}):`);
  let row = "";
  for (let k = kStart; k <= kEnd; k++) {
    const b = buf[base + k];
    if ((k - kStart) % 16 === 0) {
      if (row) console.log(`  ${row}`);
      row = `  k=${String(k).padStart(4)}: `;
    }
    row += `${b.toString(16).padStart(2,'0')} `;
  }
  if (row) console.log(`  ${row}`);
}

// Look at K=750..900 (around the first diplomacy diff cluster at 821)
console.log("=== Romans Julii (idx 0) K=750..900 (centered on 821 cluster) ===");
dumpRange(bA, baseA0, 750, 900, "save_1");
dumpRange(bB, baseB0, 750, 900, "save_3");

console.log("\n\n=== Messapians (idx 20) K=750..900 ===");
dumpRange(bA, baseA20, 750, 900, "save_1");
dumpRange(bB, baseB20, 750, 900, "save_3");

console.log("\n\n=== Romans Julii (idx 0) K=1300..1500 (second cluster + late-record) ===");
dumpRange(bA, baseA0, 1300, 1500, "save_1");
dumpRange(bB, baseB0, 1300, 1500, "save_3");

console.log("\n\n=== Messapians (idx 20) K=1300..1500 ===");
dumpRange(bA, baseA20, 1300, 1500, "save_1");
dumpRange(bB, baseB20, 1300, 1500, "save_3");

// Look for STRUCTURE: walk back from k=821 to find a section header. The 1e=30 marker recurs.
// Find all 0x1e bytes in Romans Julii's record post-region-list.
console.log("\n\n=== 0x1e markers in Romans Julii record (post region list) ===");
const playerEnd = recsA[0].pos + 100000; // generous
const limA = Math.min(playerEnd, bA.length);
let count1e = 0;
for (let i = baseA0; i < limA; i++) {
  if (bA[i] === 0x1e && (i - baseA0) < 5000) {
    // Check surrounding context for the constants
    const u32 = bA.readUInt32LE(i);
    if (u32 === 30 || u32 === 0x1e) {
      // surrounded by zeros?
      const before = bA[i - 1];
      const after4 = bA[i + 4];
      if (before === 0 || before === 0xff) {
        const k = i - baseA0;
        console.log(`  k=${k} byte=${bA[i].toString(16)} u32=${u32} before=${before.toString(16)}`);
        count1e++;
        if (count1e > 40) break;
      }
    }
  }
}
