// dig-diplomacy30.js — Look at K=1832 (potential "at peace" flag) across all
// faction records. Also K=4552. And K=2888 (M=0→2).

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

const interestingKs = [1336, 1800, 1832, 1892, 1932, 1952, 2064, 2292, 2560, 2756, 2792, 2888, 2924, 3248, 4136, 4164, 4172, 4424, 4460, 4504, 4552, 4604];

for (const k of interestingKs) {
  console.log(`\n=== K=${k} ===`);
  console.log("Idx\tNregions\tA value\tB value\tΔ");
  for (let i = 0; i < recsA.length; i++) {
    const baseA = recsA[i].pos + 52 + 4 * recsA[i].regions;
    const baseB = recsB[i].pos + 52 + 4 * recsB[i].regions;
    if (baseA + k + 4 > bA.length || baseB + k + 4 > bB.length) continue;
    const a = bA.readUInt32LE(baseA + k);
    const b = bB.readUInt32LE(baseB + k);
    const aShow = a < 1000000 ? a : `0x${a.toString(16)}`;
    const bShow = b < 1000000 ? b : `0x${b.toString(16)}`;
    const mark = a === b ? '' : '**';
    console.log(`  [${i}]\t${recsA[i].regions}\t${aShow}\t${bShow}\t${a === b ? '0' : (typeof a === 'number' && typeof b === 'number' ? (b - a) : '?')}\t${mark}`);
  }
}
