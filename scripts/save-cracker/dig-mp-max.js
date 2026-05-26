// dig-mp-max.js — find max-MP field by comparing before/after save where
// current MP drops 248 → 239.2 for Manius. The max field should stay 248.

"use strict";
const fs = require("fs");
const path = require("path");

const bufB = fs.readFileSync(path.join(__dirname, "fixtures/feral/save_mp_before.sav"));
const bufA = fs.readFileSync(path.join(__dirname, "fixtures/feral/save_mp_after.sav"));

// Manius's position record was at 0x152fe87 (from dig-mp13).
// The TRUE pos record (hdr=6 at -4) — find it.
function findPosRecord(buf, uuid) {
  for (let i = 100; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== uuid) continue;
    const hdr = i >= 4 ? buf.readUInt32LE(i - 4) : 0;
    if (hdr !== 6 && hdr !== 4) continue;
    const x = buf.readUInt32LE(i + 8);
    const y = buf.readUInt32LE(i + 12);
    if (x < 1 || x > 500 || y < 1 || y > 500) continue;
    const mp = buf.readFloatLE(i + 58);
    if (!isFinite(mp) || mp < 0 || mp > 1000) continue;
    return { offset: i, x, y, mp };
  }
  return null;
}

// We don't know Manius's uuid offhand. Brute force: find a uuid u where
// posRecord(u, bufB).mp ≈ 248 and posRecord(u, bufA).mp ≈ 239.2.
console.log("Scanning for the moved-Manius uuid…");
const candidates = [];
for (let i = 100; i < bufB.length - 64; i++) {
  const u = bufB.readUInt32LE(i);
  if (u === 0 || u === 0xffffffff) continue;
  const hdr = i >= 4 ? bufB.readUInt32LE(i - 4) : 0;
  if (hdr !== 6 && hdr !== 4) continue;
  const x = bufB.readUInt32LE(i + 8);
  const y = bufB.readUInt32LE(i + 12);
  if (x < 1 || x > 500 || y < 1 || y > 500) continue;
  const mpB = bufB.readFloatLE(i + 58);
  if (Math.abs(mpB - 248.0) > 0.01) continue;
  // Look up same uuid in bufA
  const recA = findPosRecord(bufA, u);
  if (!recA) continue;
  if (Math.abs(recA.mp - 239.2) < 1.0) {
    candidates.push({ uuid: u, offB: i, offA: recA.offset, mpB, mpA: recA.mp });
  }
  if (candidates.length > 5) break;
}
console.log(`Found ${candidates.length} candidate(s):`);
for (const c of candidates) console.log(`  uuid=0x${c.uuid.toString(16)} offB=0x${c.offB.toString(16)} mpB=${c.mpB} → mpA=${c.mpA}`);

if (candidates.length === 0) {
  console.log("No move match — search relaxed.");
  process.exit(0);
}

const c = candidates[0];
console.log(`\nInspecting field-by-field around uuid offset 0x${c.offB.toString(16)} (= +0 of record):`);
console.log("Looking for an f32 that stays = 248.0 in BOTH saves (= max MP cap).");

// Walk f32 from -16 to +120 unaligned
for (let off = -16; off <= 120; off++) {
  const oB = c.offB + off;
  const oA = c.offA + off;
  if (oB < 0 || oB + 4 > bufB.length) continue;
  if (oA < 0 || oA + 4 > bufA.length) continue;
  const fB = bufB.readFloatLE(oB);
  const fA = bufA.readFloatLE(oA);
  if (!isFinite(fB) || !isFinite(fA)) continue;
  // We want both = 248.0
  if (Math.abs(fB - 248.0) < 0.001 && Math.abs(fA - 248.0) < 0.001) {
    console.log(`  off=${off} (0x${(c.offB+off).toString(16)}): ${fB} == ${fA} = 248.0  *CANDIDATE MAX*`);
  }
}

console.log("\nAll non-zero f32 fields (unaligned) in [+40, +90]:");
for (let off = 40; off <= 90; off++) {
  const oB = c.offB + off;
  const fB = bufB.readFloatLE(oB);
  const fA = bufA.readFloatLE(c.offA + off);
  if (!isFinite(fB) || !isFinite(fA)) continue;
  if (fB === 0 && fA === 0) continue;
  if (Math.abs(fB) < 0.001 || Math.abs(fB) > 1e6) continue;
  const change = fA !== fB ? "  CHANGED" : "";
  console.log(`  off=+${off}: ${fB.toFixed(4)} → ${fA.toFixed(4)}${change}`);
}
