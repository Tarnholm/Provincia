// dig-mp13.js — what is the mirror at 0x152fe87 / 0x152fe14?
// Cluster 3 (at 0x152fe14, +166431 from Manius): byte goes 00 → 01
// Cluster 4 (at 0x152fe87): 51 b8 2e → 33 33 6f (mantissa change)

"use strict";
const fs = require("fs");
const bufB = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_before.sav");
const bufA = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_after.sav");

// Look at the mirror region
const MIRROR = 0x152fe83; // a Manius uuid hit
console.log(`Mirror at 0x${MIRROR.toString(16)}:`);
for (let i = MIRROR - 32; i < MIRROR + 80; i += 16) {
  const bef = []; const aft = [];
  for (let j = 0; j < 16; j++) {
    bef.push(bufB[i+j].toString(16).padStart(2,"0"));
    aft.push(bufA[i+j].toString(16).padStart(2,"0"));
  }
  console.log(`${i.toString(16).padStart(8,"0")}: ${bef.join(" ")} | ${aft.join(" ")}`);
}

// Read floats in this region
console.log("\nFloat fields:");
for (let off = -32; off <= 80; off += 4) {
  const o = MIRROR + off;
  if (o < 0 || o + 4 > bufB.length) continue;
  const fb = bufB.readFloatLE(o);
  const fa = bufA.readFloatLE(o);
  if (!isFinite(fb) || !isFinite(fa)) continue;
  if (fb === fa) continue;
  if (Math.abs(fb) > 1e6 || Math.abs(fa) > 1e6) continue;
  console.log(`  off=${off}: ${fb.toFixed(4)} → ${fa.toFixed(4)} (Δ ${(fa-fb).toFixed(4)})`);
}

// Read u32s
console.log("\nu32 fields (changed):");
for (let off = -32; off <= 80; off += 4) {
  const o = MIRROR + off;
  if (o < 0 || o + 4 > bufB.length) continue;
  const ub = bufB.readUInt32LE(o);
  const ua = bufA.readUInt32LE(o);
  if (ub === ua) continue;
  console.log(`  off=${off} abs=${o.toString(16)}: 0x${ub.toString(16).padStart(8,"0")} → 0x${ua.toString(16).padStart(8,"0")}`);
}
