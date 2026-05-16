// dig-mp7.js — given the MP-counter find at 0x1511fe8 (f32 248→239.2),
// scan nearby (and across other field-army records) for a max-MP field that
// matches at ~248 or 250 in both files (i.e. unchanged).

"use strict";
const fs = require("fs");
const bufB = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_before.sav");
const bufA = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_after.sav");

const MP_REM = 0x1511fe8;  // f32 248 → 239.2

// Search +/- 256 bytes for any other f32 in 0..500 range
console.log("Floats in window [MP_REM-256..MP_REM+256] (B vs A):");
for (let off = -256; off <= 256; off += 1) {
  const o = MP_REM + off;
  if (o < 0 || o + 4 > bufB.length || o + 4 > bufA.length) continue;
  const fb = bufB.readFloatLE(o);
  const fa = bufA.readFloatLE(o);
  if (!isFinite(fb) || !isFinite(fa)) continue;
  if (fb < 1 || fb > 1000) continue;
  if (fa < 1 || fa > 1000) continue;
  const delta = fa - fb;
  console.log(`  off=${off>=0?"+":""}${off} abs=${o.toString(16)}: ${fb.toFixed(4)} → ${fa.toFixed(4)}  (Δ ${delta.toFixed(4)})`);
}

// Try u32 view at MP_REM
console.log("\nu32 view around MP_REM:");
for (let off = -64; off <= 64; off += 4) {
  const o = MP_REM + off;
  const ub = bufB.readUInt32LE(o);
  const ua = bufA.readUInt32LE(o);
  console.log(`  off=${off>=0?"+":""}${off} abs=${o.toString(16)}: B=0x${ub.toString(16).padStart(8,"0")} A=0x${ua.toString(16).padStart(8,"0")}`);
}
