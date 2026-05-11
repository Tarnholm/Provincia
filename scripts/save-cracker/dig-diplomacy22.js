// dig-diplomacy22.js — Investigate the repeating pattern.
// The recurring structure is:
//   [ff ff ff 00 00 00 00 02 00 00 00 00 00 00 00 00 03→02 00 00 00 ZZ ZZ 00 00 ...]
// This appears at offsets across the body. Each diff is the byte after the
// 16-byte preamble. The "02" before sounds like a u32 count, and "03→02" or
// "00→02" looks like a decrement counter. Let's find ALL occurrences of this
// 16-byte preamble (`ff ff ff 00 00 00 00 02 00 00 00 00 00 00 00 00`) in
// save_1 and save_3 and dump the byte that follows + 4 u32 after.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

// Look for the 16-byte preamble
const PRE = Buffer.from([0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function findAll(buf, pre) {
  const out = [];
  for (let i = 0; i + pre.length < buf.length; i++) {
    let ok = true;
    for (let j = 0; j < pre.length; j++) {
      if (buf[i + j] !== pre[j]) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

console.log("scanning A...");
const hitsA = findAll(bA, PRE);
console.log(`found ${hitsA.length} preamble hits in A`);
console.log("scanning B...");
const hitsB = findAll(bB, PRE);
console.log(`found ${hitsB.length} preamble hits in B`);

// for each hit, read the u32 at hit+16, hit+20, hit+24, hit+28
console.log("\nFirst 30 A hits:");
for (let i = 0; i < Math.min(30, hitsA.length); i++) {
  const o = hitsA[i];
  const v1 = bA.readUInt32LE(o + 16);
  const v2 = bA.readUInt32LE(o + 20);
  const v3 = bA.readUInt32LE(o + 24);
  const v4 = bA.readUInt32LE(o + 28);
  console.log(`  A[${i}] 0x${o.toString(16)}: v0=${v1} v1=${v2} v2=${v3} v3=${v4}`);
}
console.log("\nFirst 30 B hits:");
for (let i = 0; i < Math.min(30, hitsB.length); i++) {
  const o = hitsB[i];
  const v1 = bB.readUInt32LE(o + 16);
  const v2 = bB.readUInt32LE(o + 20);
  const v3 = bB.readUInt32LE(o + 24);
  const v4 = bB.readUInt32LE(o + 28);
  console.log(`  B[${i}] 0x${o.toString(16)}: v0=${v1} v1=${v2} v2=${v3} v3=${v4}`);
}
