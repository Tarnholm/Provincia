// dig-alliance-deep10.js
// Cell [238][238] changed in 8 bytes between save_2 and save_3 — +44..+47 and +121..+124.
// What are these u32 values? Could be a "list head" pointer that grew when alliance added.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

const MAT = 0xf8fd2;
const STRIDE = 267;

function cellOffset(r, c) { return MAT + (r * 239 + c) * STRIDE; }

const off = cellOffset(238, 238);
console.log(`Cell [238][238] at 0x${off.toString(16)}`);
console.log("\nA (save_2.1) +0..+267:");
console.log(A.slice(off, off + STRIDE).toString("hex"));
console.log("\nB (save_3.1) +0..+267:");
console.log(B.slice(off, off + STRIDE).toString("hex"));

console.log("\n+44 u32: A=" + A.readUInt32LE(off + 44) + " B=" + B.readUInt32LE(off + 44));
console.log("+121 u32: A=" + A.readUInt32LE(off + 121) + " B=" + B.readUInt32LE(off + 121));

// Also check the same comparison across all save pairs in the corpus
// to see the cell [238][238] pattern.
const saves = ["save_1.1.sav", "save_2.1.sav", "save_3.1.sav", "save_4.1.sav", "save_5.1.sav",
               "save_6.1.sav", "save_7.1.sav", "save_8.1.sav", "save_9.1.sav",
               "save_10.1.sav", "save_11.1.sav", "save_12.1.sav"];
console.log("\nCell [238][238] +44 and +121 across all saves:");
for (const s of saves) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const v44 = buf.readUInt32LE(off + 44);
  const v121 = buf.readUInt32LE(off + 121);
  console.log(`  ${s}: +44=${v44}, +121=${v121}`);
}

// Also check cells [0][0] and [156][156] (self cells) for the same offsets
console.log("\nCell [0][0] +44 and +121 across saves:");
for (const s of saves) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const o = cellOffset(0, 0);
  console.log(`  ${s}: +44=${buf.readUInt32LE(o+44)}, +121=${buf.readUInt32LE(o+121)}`);
}

console.log("\nCell [0][156] +44 and +121 across saves:");
for (const s of saves) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const o = cellOffset(0, 156);
  console.log(`  ${s}: +44=${buf.readUInt32LE(o+44)}, +121=${buf.readUInt32LE(o+121)}`);
}

console.log("\nCell [156][156] +44 and +121 across saves:");
for (const s of saves) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, s));
  const o = cellOffset(156, 156);
  console.log(`  ${s}: +44=${buf.readUInt32LE(o+44)}, +121=${buf.readUInt32LE(o+121)}`);
}
