// dig-soldier-stats2.js — Find unit-records in field-army block using unit-name ASCII pattern.
// Roman general etc.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

// Find all u16-prefixed ASCII strings of length 5-50 in the tail region.
function findUnitsInTail(buf, tailStart) {
  // Tail starts at fixed position per save (after settlement zone).
  // For these saves, settlement zone ends around 0x1f00000 and tail goes to file end.
  const records = [];
  const start = tailStart;
  const end = buf.length;
  for (let i = start; i + 2 < end; i++) {
    const len = buf.readUInt16LE(i);
    if (len < 5 || len > 50) continue;
    // Check chars are ASCII printable lowercase letters/spaces
    let ok = true;
    for (let c = 0; c < len; c++) {
      const b = buf[i + 2 + c];
      if (b < 0x20 || b > 0x7e) { ok = false; break; }
    }
    if (!ok) continue;
    // After name should be 0xee or similar marker
    if (buf[i + 2 + len] !== 0xee) continue;
    const name = buf.subarray(i + 2, i + 2 + len).toString("ascii");
    // Filter: must look like a unit name (lowercase + space)
    if (!/^[a-z][a-z _]+$/.test(name)) continue;
    records.push({ start: i, name, len });
    i += len + 2;
  }
  return records;
}

// Try multiple tail starts
console.log("=== A: find tail beginning ===");
console.log(`File size: 0x${bA.length.toString(16)}`);

// Look at largest concentration of 0xee bytes (unit-name terminators)
function findEeClusters(buf, blockSize=0x100000) {
  const out = [];
  for (let start = 0; start < buf.length; start += blockSize) {
    let count = 0;
    const end = Math.min(buf.length, start + blockSize);
    for (let i = start; i < end; i++) if (buf[i] === 0xee) count++;
    out.push({ start, end, count });
  }
  return out;
}

const eeA = findEeClusters(bA);
const eeB = findEeClusters(bB);
console.log("\nEE byte density (1MB blocks):");
console.log("offset_block  A   B");
for (let i = 0; i < eeA.length; i++) {
  if (eeA[i].count > 50 || eeB[i].count > 50) {
    console.log(`  0x${eeA[i].start.toString(16)}-0x${eeA[i].end.toString(16)}  A=${eeA[i].count}  B=${eeB[i] ? eeB[i].count : '?'}`);
  }
}

// Now look at 0xee byte density in 64KB blocks in the highest-density 1MB region
console.log("\n=== Higher-resolution 64KB-block scan of highest 0xee density ===");
function findEeClusters64k(buf) {
  const blockSize = 0x10000;
  const out = [];
  for (let start = 0; start < buf.length; start += blockSize) {
    let count = 0;
    const end = Math.min(buf.length, start + blockSize);
    for (let i = start; i < end; i++) if (buf[i] === 0xee) count++;
    if (count > 30) out.push({ start, end, count });
  }
  return out;
}

const ee64A = findEeClusters64k(bA);
const ee64B = findEeClusters64k(bB);
console.log("A density bins:");
for (const b of ee64A.slice(0, 50)) console.log(`  0x${b.start.toString(16)} count=${b.count}`);
console.log("B density bins:");
for (const b of ee64B.slice(0, 50)) console.log(`  0x${b.start.toString(16)} count=${b.count}`);
