// dig-ownership4.js — Inspect Uria & Brundisium settlement records in depth.
// Also: check Romans Julii region-list vs Messapians region-list for static-ness.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

// 1. Check Romans Julii region list (should INCLUDE Uria=1048 if Romans now own it?)
//    Per session 9, the region list is STATIC homeland — won't update.
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

function regionList(buf, rec) {
  const out = [];
  for (let k = 0; k < rec.regions; k++) out.push(buf.readUInt32LE(rec.pos + 52 + k * 4));
  return out;
}

console.log("=== Romans Julii region list ===");
console.log("A: " + regionList(bA, recsA[0]).slice().sort((a,b)=>a-b).join(','));
console.log("B: " + regionList(bB, recsB[0]).slice().sort((a,b)=>a-b).join(','));
const sameRomans = regionList(bA, recsA[0]).join(',') === regionList(bB, recsB[0]).join(',');
console.log("Identical: " + sameRomans);

console.log("\n=== Messapians region list ===");
const mA = regionList(bA, recsA[20]);
const mB = regionList(bB, recsB[20]);
console.log("A: " + mA.join(','));
console.log("B: " + mB.join(','));
console.log("Identical: " + (mA.join(',') === mB.join(',')));

// 2. Inspect Uria's settlement record. Need to find the "owner faction" byte.
// Brundisium @ 0x1263b02 (UTF-16). Uria @ 0x1264864.
// Per the dump session 3 showed both have a header that starts ~0x20 before the name.

// Search for owner byte: in the per-settlement record, there should be a field
// indicating the faction-id of the owner. For Uria, that should change from
// "messapians" to "romans_julii" between save_1 and save_3.
//
// Look at bytes preceding and following Uria's name.

const URIA_A = 0x1264864;
const URIA_B = 0x1264864;
const BRUND_A = 0x1263b02;
const BRUND_B = 0x1263b02;

function dumpRecord(buf, off, recName, label) {
  console.log(`\n=== ${recName} record (${label}, name @0x${off.toString(16)}) ===`);
  // walk back to find record header (look for u32 self-pointer or [u32 prev][u32 next])
  console.log("bytes -64 to +400:");
  for (let i = off - 64; i < off + 400; i += 16) {
    const row = Array.from(buf.subarray(i, i + 16)).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(buf.subarray(i, i + 16)).map(x => (x >= 0x20 && x <= 0x7e ? String.fromCharCode(x) : '.')).join('');
    const ascii16 = "";
    console.log(`  0x${i.toString(16)}: ${row}  ${ascii}`);
  }
}

dumpRecord(bA, URIA_A, "Uria", "save_1");
dumpRecord(bB, URIA_B, "Uria", "save_3");
