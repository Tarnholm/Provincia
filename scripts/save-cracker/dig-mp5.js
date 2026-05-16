// dig-mp5.js — inspect the region around 0x1511fba (y=425→424) to find the
// full position record: x, y, and any MP/has-moved data nearby.

"use strict";
const fs = require("fs");
const bufB = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_before.sav");
const bufA = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_after.sav");

// Centre on 0x1511fba and dump 256 bytes back + 128 bytes forward.
const C = 0x1511fba;
const back = 256, fwd = 256;
const s = C - back, e = C + fwd;

console.log(`Window [${s.toString(16)}..${e.toString(16)}]`);

// Search backwards for x=275 (0x113 LE = 0x13 0x01 0x00 0x00) — the x-coord.
const xBytes = Buffer.from([0x13, 0x01, 0x00, 0x00]);
// Search forward + backward from C
console.log("\nSearch for x=275 (13 01 00 00) within +/-256 of y-coord:");
for (let i = s; i <= e - 4; i++) {
  if (bufB[i] === 0x13 && bufB[i+1] === 0x01 && bufB[i+2] === 0x00 && bufB[i+3] === 0x00 &&
      bufA[i] === 0x13 && bufA[i+1] === 0x01 && bufA[i+2] === 0x00 && bufA[i+3] === 0x00) {
    console.log(`  found x=275 at abs ${i.toString(16)} (${i-C} from y-cluster)`);
  }
}

// Also dump 64 bytes around C in both
console.log("\nBytes around y-cluster (0x1511fba):");
console.log("offset    | BEFORE                                                      | AFTER");
for (let i = C - 64; i < C + 64; i += 16) {
  const bef = [];
  const aft = [];
  for (let j = 0; j < 16; j++) {
    bef.push(bufB[i+j].toString(16).padStart(2, "0"));
    aft.push(bufA[i+j].toString(16).padStart(2, "0"));
  }
  console.log(`${i.toString(16).padStart(8,"0")}: ${bef.join(" ")} | ${aft.join(" ")}`);
}

console.log("\nBytes around 0x1511fe8 (second diff cluster):");
const C2 = 0x1511fe8;
for (let i = C2 - 32; i < C2 + 32; i += 16) {
  const bef = [];
  const aft = [];
  for (let j = 0; j < 16; j++) {
    bef.push(bufB[i+j].toString(16).padStart(2, "0"));
    aft.push(bufA[i+j].toString(16).padStart(2, "0"));
  }
  console.log(`${i.toString(16).padStart(8,"0")}: ${bef.join(" ")} | ${aft.join(" ")}`);
}

// What section is 0x1511fba in?
// From serialize.js claims:
//   0xa8beb..0xf8fd2 -> character-paths
//   0xf8fd2..(0xf8fd2+240*238*267) tile-grid
//   0x14e5ac6..0x1501615  merc-pool
// So 0x1511fba is just past the merc-pool, in field-army territory
const SETTLEMENT = 0xf85f00;
console.log(`\nOffset 0x1511fba = ${0x1511fba}`);
console.log(`  character-paths ends at: 0xf8fd2 = ${0xf8fd2}`);
console.log(`  tile-grid ends at:       0xf8fd2 + 240*238*267 = ${0xf8fd2 + 240*238*267}`);
console.log(`  merc-pool ends at:       0x1501615`);
console.log(`  settlement zone start:   0xf85f00`);
