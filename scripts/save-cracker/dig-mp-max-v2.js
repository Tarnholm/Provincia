// dig-mp-max-v2.js — broader scan: find every f32 == 248.0 in the save and
// check if its mate in the "after" save is also still 248.0 AND located in
// a stable position relative to Manius's pos record. This finds the max
// stored elsewhere (unit record, character block).

"use strict";
const fs = require("fs");
const path = require("path");

const bufB = fs.readFileSync(path.join(__dirname, "fixtures/feral/save_mp_before.sav"));
const bufA = fs.readFileSync(path.join(__dirname, "fixtures/feral/save_mp_after.sav"));

const MANIUS_POS_OFF = 0x1511fae; // confirmed in v1
const MANIUS_UUID = 0x71a994f2;

console.log("All f32 = 248.0 (±0.001) in BOTH saves at same offset:");
let candidates = [];
for (let i = 4; i < bufB.length - 4; i++) {
  const fB = bufB.readFloatLE(i);
  if (Math.abs(fB - 248.0) > 0.001) continue;
  if (i + 4 > bufA.length) continue;
  const fA = bufA.readFloatLE(i);
  if (Math.abs(fA - 248.0) > 0.001) continue;
  candidates.push(i);
}
console.log(`Total ${candidates.length} matches.`);

// Filter: nearby Manius records or has Manius uuid in vicinity.
const uuidBuf = Buffer.alloc(4);
uuidBuf.writeUInt32LE(MANIUS_UUID);
console.log("\nMatches with Manius uuid within ±2048 bytes:");
let near = 0;
for (const off of candidates) {
  const lo = Math.max(0, off - 2048);
  const hi = Math.min(bufB.length, off + 2048);
  const slice = bufB.slice(lo, hi);
  const idx = slice.indexOf(uuidBuf);
  if (idx === -1) continue;
  const uuidAbs = lo + idx;
  const distFromManius = off - MANIUS_POS_OFF;
  console.log(`  off=0x${off.toString(16)} (Δ from pos: ${distFromManius >= 0 ? "+" : ""}${distFromManius}); nearby uuid @0x${uuidAbs.toString(16)}`);
  near++;
  if (near > 40) { console.log("…truncated"); break; }
}

// Look around the position record at -1024..+512 for 248.0 specifically
console.log("\nFloat 248.0 specifically in [-1024, +512] window around Manius pos record:");
for (let off = -1024; off <= 512; off++) {
  const o = MANIUS_POS_OFF + off;
  if (o < 0 || o + 4 > bufB.length) continue;
  const fB = bufB.readFloatLE(o);
  if (Math.abs(fB - 248.0) > 0.001) continue;
  const fA = bufA.readFloatLE(o);
  console.log(`  off=${off}: B=${fB} A=${fA}`);
}
