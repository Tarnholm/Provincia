// dig-diplomacy28.js — Examine the K values where ONLY Romans Julii (idx 0)
// AND Messapians (idx 20) change. This is the diplomacy enum candidate.

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

// Focus on idx 0 (Romans Julii) and idx 20 (Messapians)
const a0 = recsA[0], a20 = recsA[20];
const b0 = recsB[0], b20 = recsB[20];
const baseA0 = a0.pos + 52 + 4 * a0.regions;
const baseA20 = a20.pos + 52 + 4 * a20.regions;
const baseB0 = b0.pos + 52 + 4 * b0.regions;
const baseB20 = b20.pos + 52 + 4 * b20.regions;

console.log(`Romans Julii (idx 0): A=0x${baseA0.toString(16)}  B=0x${baseB0.toString(16)}`);
console.log(`Messapians (idx 20): A=0x${baseA20.toString(16)}  B=0x${baseB20.toString(16)}`);

// Ks where ONLY 0 and 20 change: 821, 823-826, 1334-1336
const interestingKs = [821, 823, 824, 825, 826, 1334, 1335, 1336];

console.log("\n=== Key Ks (only Romans + Messapians changed) ===");
console.log("K\tRomansA\tRomansB\tMessapA\tMessapB");
for (const k of interestingKs) {
  const ra = bA[baseA0 + k];
  const rb = bB[baseB0 + k];
  const ma = bA[baseA20 + k];
  const mb = bB[baseB20 + k];
  console.log(`${k}\t${ra}\t${rb}\t${ma}\t${mb}`);
}

// Print broader range around these Ks for Romans and Messapians, side-by-side
function side(label, baseA, baseB, kStart, kEnd) {
  console.log(`\n=== ${label} k=${kStart}..${kEnd} ===`);
  for (let k = kStart; k <= kEnd; k++) {
    const aV = bA[baseA + k], bV = bB[baseB + k];
    const mark = aV === bV ? '  ' : '**';
    console.log(`  k=${k}\tA=${aV.toString(16).padStart(2,'0')}(${aV})\tB=${bV.toString(16).padStart(2,'0')}(${bV})  ${mark}`);
  }
}

side("Romans Julii", baseA0, baseB0, 815, 835);
side("Messapians", baseA20, baseB20, 815, 835);
side("Romans Julii", baseA0, baseB0, 1330, 1345);
side("Messapians", baseA20, baseB20, 1330, 1345);
