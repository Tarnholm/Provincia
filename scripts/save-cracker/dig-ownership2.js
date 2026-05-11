// dig-ownership2.js — Investigate Uria appearances around 0x1264864 and the
// new occurrences at 0x20cf... in save_3.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";
const SAVE_B = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_3.sav";

const bA = fs.readFileSync(SAVE_A);
const bB = fs.readFileSync(SAVE_B);

function hex(buf, o, n) {
  return Array.from(buf.subarray(o, o + n)).map(x => x.toString(16).padStart(2, '0')).join(' ');
}
function ascii(buf, o, n) {
  return Array.from(buf.subarray(o, o + n)).map(x => (x >= 0x20 && x <= 0x7e ? String.fromCharCode(x) : '.')).join('');
}

console.log("=== Uria @ 0x1264864 in save_1 ===");
console.log(`  before: ${hex(bA, 0x1264844, 32)}`);
console.log(`  before ASCII: ${ascii(bA, 0x1264844, 32)}`);
console.log(`  name+after: ${hex(bA, 0x1264862, 64)}`);
console.log(`  name+after ASCII: ${ascii(bA, 0x1264862, 64)}`);

console.log("\n=== Uria @ 0x1264864 in save_3 ===");
console.log(`  before: ${hex(bB, 0x1264844, 32)}`);
console.log(`  before ASCII: ${ascii(bB, 0x1264844, 32)}`);
console.log(`  name+after: ${hex(bB, 0x1264862, 64)}`);
console.log(`  name+after ASCII: ${ascii(bB, 0x1264862, 64)}`);

// Brundisium
console.log("\n=== Brundisium @ 0x1263b02 (same in both saves) ===");
console.log(`  A before: ${hex(bA, 0x1263ae2, 32)}`);
console.log(`  A name+after: ${hex(bA, 0x1263b00, 80)}`);
console.log(`  B before: ${hex(bB, 0x1263ae2, 32)}`);
console.log(`  B name+after: ${hex(bB, 0x1263b00, 80)}`);
// Are they identical at this spot?
const sameAtSet = bA.subarray(0x1263a00, 0x1264900).equals(bB.subarray(0x1263a00, 0x1264900));
console.log(`Settlement region 0x1263a00..0x1264900 identical between A and B: ${sameAtSet}`);

// Compute first diff position around Brundisium
console.log("\nFirst diffs around 0x1263a00..0x1265000:");
let count = 0;
for (let i = 0x1263a00; i < 0x1265000 && count < 40; i++) {
  if (bA[i] !== bB[i]) {
    console.log(`  0x${i.toString(16)}  A=${bA[i].toString(16).padStart(2,'0')} B=${bB[i].toString(16).padStart(2,'0')}`);
    count++;
  }
}

console.log("\n=== NEW Uria @ 0x20cf68f in save_3 (4 occurrences ~50 bytes apart) ===");
for (const offset of [0x20cf68f, 0x20cf783, 0x20cf868, 0x20cf957]) {
  console.log(`  offset 0x${offset.toString(16)}:`);
  console.log(`    before: ${hex(bB, offset - 32, 32)}  ASCII: ${ascii(bB, offset - 32, 32)}`);
  console.log(`    Uria+after: ${hex(bB, offset - 2, 80)}  ASCII: ${ascii(bB, offset - 2, 80)}`);
}
