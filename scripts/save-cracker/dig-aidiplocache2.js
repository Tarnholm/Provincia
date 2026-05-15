// dig-aidiplocache2.js — session 62 attempt 2.
// Session 61 mis-diagnosed gap-#6 family as "random hash header + AI cache".
// dig-aidiplocache1.js showed:
//   T1 contains "Eastern_Town", "Celtic_City", "Carthaginian_Huge_City",
//       "Celtic_Town", "W_hellenistic_Large_Town" — SETTLEMENT BUILDING strings.
//   T2/T5 contain UTF-16 spawn-script paths ".../cilicians_revolt.txt", ".../lycia_revolt.txt".
//   T3 contains a portrait path "data/ui/eastern/portraits/.../106.tga".
//   Each ends with `<8 B uuid-ish> 00 00 00 00 1e 00 00 00 00*` — the terminator.
//   Each is preceded by 40 B of 8-byte stride records that look identical
//   to the blob's first 40 B (i.e., the blob extends BACKWARD into a larger record).
//
// So these are NOT random hash AI caches — they are **per-settlement records**
// the existing settlement-marker scanner missed. The 8-byte stride structure
// (00 LL HH 00 00 LL HH 00) at the start of each looks like a known
// settlement substructure (probably a tile-bitmap or pop-pool array).
//
// Plan for this attempt:
//   1. Walk BACKWARD from each target start to find the true record start.
//      Look for an `ff 0a af f0` / `f0 0a af f0` taw magic, or a settlement
//      magic, or a self-pointer.
//   2. Walk FORWARD from each target end past the terminator to find the
//      enclosing structure.
//   3. Cross-compare the head structure to a known settlement record's start.
//   4. Look for a u32 region/settlement ID near the head.

"use strict";

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const buf = fs.readFileSync(SAVE);

const TARGETS = [
  { start: 0x01f1a697, end: 0x01f1fc14, label: "T1-21885" },
  { start: 0x018be452, end: 0x018c1c1d, label: "T2-14283" },
  { start: 0x01d000d6, end: 0x01d0373b, label: "T3-13925" },
  { start: 0x01cf5669, end: 0x01cf8cbb, label: "T4-13906" },
  { start: 0x01a9372d, end: 0x01a96d0e, label: "T5-13793" },
];

function hex(p, n) {
  return Array.from(buf.slice(p, p + n)).map(b => b.toString(16).padStart(2, "0")).join(" ");
}
function asc(p, n) {
  return Array.from(buf.slice(p, p + n)).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".").join("");
}

// 1) Walk backward from each target start, look for taw magic + ascii.
console.log("=== Walking backward from each target start, looking for marker ===");
for (const t of TARGETS) {
  console.log(`\n-- ${t.label} (start 0x${t.start.toString(16)}) --`);
  // Look in [start - 4096 .. start) for ff/f0 0a af f0 magic.
  const SEARCH = 4096;
  const lo = Math.max(0, t.start - SEARCH);
  let hits = [];
  for (let p = lo; p < t.start; p++) {
    if ((buf[p] === 0xff || buf[p] === 0xf0) && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
      hits.push(p);
    }
  }
  console.log(`  taw magic hits in [start-4K..start): ${hits.length}`);
  for (const h of hits.slice(-5)) console.log(`    0x${h.toString(16)}  (start-${t.start-h})`);

  // Hex dump 64 B at start - 1024, start - 512, start - 256, start - 128, start - 64.
  for (const off of [1024, 512, 256, 128, 64, 32]) {
    const p = t.start - off;
    console.log(`  start-${off}: 0x${p.toString(16)}  ${hex(p, 32)}  ${asc(p, 32)}`);
  }
}

// 2) Walk FORWARD past terminator. After last 256 B dump we saw
//    ff 0a af f0 ... f0 0a af f0 just after T1 end. Confirm via full dump.
console.log("\n=== 256 B AFTER each target's end ===");
for (const t of TARGETS) {
  console.log(`\n-- ${t.label} (end 0x${t.end.toString(16)}) --`);
  for (let p = t.end; p < t.end + 256; p += 32) {
    console.log(`  0x${p.toString(16)}  ${hex(p, 32)}  ${asc(p, 32)}`);
  }
}

// 3) Where does the 8-byte-stride pattern actually start?
//    Look for the FIRST 8-byte stride record going backward from t.start.
//    Stride pattern: byte+0=00, byte+5=>0x14, byte+6=0x30/0x40/0x50/0x60/0x70, byte+7=00.
//    Actually, looking at the data: blob body is `00 00 00 00 00 00 LL HH` where
//    LL HH is small (0x1400..0x1770).  So byte+6 ∈ [0x14, 0x17] mostly.

console.log("\n=== Walk backward, find longest run where buf[p+6] in [0x14..0x17] && buf[p+7]==0 && buf[p]==0 (stride 8) ===");
for (const t of TARGETS) {
  let earliest = t.start;
  let p = t.start - 8;
  let breakCount = 0;
  while (p > 0 && breakCount < 3) {
    const ok = buf[p] === 0x00 &&
               buf[p+6] >= 0x14 && buf[p+6] <= 0x17 &&
               buf[p+7] === 0x00;
    if (ok) {
      earliest = p;
      breakCount = 0;
    } else {
      breakCount++;
    }
    p -= 8;
  }
  console.log(`  ${t.label}: stride-record run starts ~0x${earliest.toString(16)} (start-${t.start-earliest})`);
  // Dump 32 B at the discovered start.
  console.log(`    head:  ${hex(earliest, 32)}  ${asc(earliest, 32)}`);
  console.log(`    -32:   ${hex(earliest-32, 32)}  ${asc(earliest-32, 32)}`);
}

// 4) Check: do these blobs sit INSIDE a building-chain record or settlement
//    block? Print the nearest preceding `ff 0a af f0` and its self-pointer
//    + size fields to see the enclosing taw record.
console.log("\n=== Nearest preceding taw record (ff/f0 0a af f0) and its decoded size ===");
for (const t of TARGETS) {
  let nearest = -1;
  for (let p = t.start - 1; p > Math.max(0, t.start - 65536); p--) {
    if ((buf[p] === 0xff || buf[p] === 0xf0) && buf[p+1] === 0x0a && buf[p+2] === 0xaf && buf[p+3] === 0xf0) {
      nearest = p;
      break;
    }
  }
  if (nearest < 0) { console.log(`  ${t.label}: no taw magic in [start-64K..start)`); continue; }
  // taw record: <u32 selfPtr> <u32 size> <magic> ... or <magic> <u32 selfPtr> <u32 size> ...
  // Try both interpretations.
  const selfBefore = buf.readUInt32LE(nearest - 8);
  const sizeBefore = buf.readUInt32LE(nearest - 4);
  const selfAfter  = buf.readUInt32LE(nearest + 4);
  const sizeAfter  = buf.readUInt32LE(nearest + 8);
  console.log(`  ${t.label}: magic@0x${nearest.toString(16)} (start-${t.start-nearest})`);
  console.log(`    if {selfPtr,size}@magic-8: self=0x${selfBefore.toString(16)} size=${sizeBefore} (would end at 0x${(selfBefore+sizeBefore).toString(16)})`);
  console.log(`    if {magic, selfPtr@+4, size@+8}: self=0x${selfAfter.toString(16)} size=${sizeAfter} (would end at 0x${(selfAfter+sizeAfter).toString(16)})`);
}

// 5) Look at the terminator pattern more closely.
//    After each blob: <8 B uuid-ish> <u32 small-count> <00 00 00 00 1e 00 00 00>
//    The `1e 00 00 00` is 30. Could be tile-count / sub-count / radius / something.
//    Look 64 B before the terminator inside each blob.
console.log("\n=== 96 B before each target's end (terminator inspection) ===");
for (const t of TARGETS) {
  console.log(`\n-- ${t.label} --`);
  for (let p = t.end - 96; p < t.end; p += 32) {
    console.log(`  0x${p.toString(16)}  ${hex(p, 32)}  ${asc(p, 32)}`);
  }
}

// 6) The strings in T1 (Eastern_Town, Celtic_City, etc.) look like
//    BUILDING-CHAIN entries. Check: are they preceded by a length-prefix u16/u32?
//    Find "Carthaginian_Huge_City" in T1 and look back 4 B.
const probe1 = Buffer.from("Carthaginian_Huge_City");
let pos = buf.indexOf(probe1, TARGETS[0].start);
console.log(`\n=== "Carthaginian_Huge_City" first in T1 at 0x${pos.toString(16)} ===`);
console.log(`  -16 B:  ${hex(pos - 16, 16)}  ${asc(pos - 16, 16)}`);
console.log(`  -8 B:   ${hex(pos - 8, 8)}  ${asc(pos - 8, 8)}`);
console.log(`  -4 B:   ${hex(pos - 4, 4)}  ${asc(pos - 4, 4)} -> u32=${buf.readUInt32LE(pos-4)} u16=${buf.readUInt16LE(pos-2)}`);
console.log(`  +str:   ${hex(pos, 32)}  ${asc(pos, 32)}`);

// And find the FIRST occurrence anywhere — is there one in the canonical
// settlement zone we already parse?
const allOcc = [];
let q = 0;
while (q < buf.length) {
  const i = buf.indexOf(probe1, q);
  if (i < 0) break;
  allOcc.push(i);
  q = i + 1;
}
console.log(`  total occurrences of "Carthaginian_Huge_City" in file: ${allOcc.length}`);
for (const o of allOcc.slice(0, 8)) console.log(`    0x${o.toString(16)}`);
