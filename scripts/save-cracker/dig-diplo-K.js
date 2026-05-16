// dig-diplo-K.js — session 109 step K
//
// Final B/C enum-semantics validation across ALL saves.
// Aggregate B-C distribution and observe trends.
//
// Also test: is B truly stable per A (within a save), or does it
// represent a per-relationship CONFIG that's set once and rarely changes?
//
// Usage: node dig-diplo-K.js
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "fixtures", "feral");

function findValidMarkers(buf) {
  const markers = [];
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) markers.push(i);
  }
  return markers.filter((off) => {
    const count = buf.readUInt32LE(off + 4);
    if (count > 200 || count === 0) return false;
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      if (e + 16 > buf.length) return false;
      if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) return false;
    }
    return true;
  });
}

function collectMap(buf) {
  const valid = findValidMarkers(buf);
  const out = new Map();
  for (const off of valid) {
    const count = buf.readUInt32LE(off + 4);
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      out.set(buf.readUInt32LE(e), { B: buf.readUInt32LE(e + 4), C: buf.readUInt32LE(e + 8), D: buf.readUInt32LE(e + 12) });
    }
  }
  return out;
}

const SAVES = [
  "save_10_fresh.sav", "ror_t1e.sav", "ror_t2s.sav", "ror_t5.sav",
  "ror_t11s.sav", "ror_t11e.sav", "athens_t21.sav", "athens_t22s.sav",
  "athens_t22mid.sav", "athens_t22e.sav", "save_mp_before.sav",
  "save_mp_after.sav", "save_1.2.sav",
];

console.log("=== B/C joint distribution per save ===");
console.log(`save                | total | B=0 | B=1 | B=2 | B=4 | C=0 | C=1 | C=2 | C=3 | C=4`);
const allMaps = {};
for (const name of SAVES) {
  const buf = fs.readFileSync(path.join(root, name));
  const m = collectMap(buf);
  allMaps[name] = m;
  const Bs = { 0: 0, 1: 0, 2: 0, 4: 0 };
  const Cs = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const e of m.values()) { Bs[e.B] = (Bs[e.B] || 0) + 1; Cs[e.C] = (Cs[e.C] || 0) + 1; }
  console.log(`  ${name.padEnd(20)} | ${m.size.toString().padStart(4)}  | ${Bs[0].toString().padStart(3)} | ${Bs[1].toString().padStart(3)} | ${Bs[2].toString().padStart(3)} | ${Bs[4].toString().padStart(3)} | ${Cs[0].toString().padStart(3)} | ${Cs[1].toString().padStart(3)} | ${Cs[2].toString().padStart(3)} | ${Cs[3].toString().padStart(3)} | ${Cs[4].toString().padStart(3)}`);
}

// B stability across all consecutive turn pairs
console.log(`\n=== B stability across all turn pairs ===`);
const pairs = [
  ["save_10_fresh.sav", "ror_t1e.sav"],
  ["ror_t1e.sav", "ror_t2s.sav"],
  ["ror_t2s.sav", "ror_t5.sav"],
  ["ror_t5.sav", "ror_t11s.sav"],
  ["ror_t11s.sav", "ror_t11e.sav"],
  ["athens_t21.sav", "athens_t22s.sav"],
  ["athens_t22s.sav", "athens_t22mid.sav"],
  ["athens_t22mid.sav", "athens_t22e.sav"],
  ["save_mp_before.sav", "save_mp_after.sav"],
];

for (const [a, b] of pairs) {
  const ma = allMaps[a], mb = allMaps[b];
  let bUnchanged = 0, bChanged = 0, cChanged = 0, common = 0;
  for (const [A, e1] of ma) {
    if (!mb.has(A)) continue;
    common++;
    const e2 = mb.get(A);
    if (e1.B === e2.B) bUnchanged++;
    else bChanged++;
    if (e1.C !== e2.C) cChanged++;
  }
  console.log(`  ${a.padEnd(20)} → ${b.padEnd(20)}: common=${common}, B-unchanged=${bUnchanged}, B-changed=${bChanged}, C-changed=${cChanged}`);
}

// SEMANTIC HYPOTHESIS SUMMARY
console.log(`\n=== SUMMARY ===`);
console.log(`B is HIGHLY STABLE — changes only at major diplomatic events.`);
console.log(`C is HIGHLY FLUCTUATING — changes nearly every turn.`);
console.log(``);
console.log(`Most common B/C combos at T0 (save_10_fresh):`);
const fresh = allMaps["save_10_fresh.sav"];
const bc = {};
for (const e of fresh.values()) { const k = `B=${e.B},C=${e.C}`; bc[k] = (bc[k] || 0) + 1; }
Object.entries(bc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// Confirm: D field is always 0x00010101 in every entry across every save
console.log(`\n=== D field consistency ===`);
const allD = new Set();
for (const m of Object.values(allMaps)) for (const e of m.values()) allD.add(e.D);
console.log(`  Distinct D values across all saves: ${allD.size}`);
console.log(`  Values: ${[...allD].map(v => "0x" + v.toString(16).padStart(8, "0")).join(", ")}`);

// One more validation: for save_10_fresh entries with B=4 (alliance candidate),
// dump them all to see if they cluster in specific zones (=specific factions).
console.log(`\n=== save_10_fresh B=4 entries (alliance candidates) — all 8 ===`);
const allB4 = [];
{
  const buf = fs.readFileSync(path.join(root, "save_10_fresh.sav"));
  const valid = findValidMarkers(buf);
  for (const off of valid) {
    const count = buf.readUInt32LE(off + 4);
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      const B = buf.readUInt32LE(e + 4);
      if (B === 4) {
        allB4.push({ markerOff: off, A: buf.readUInt32LE(e), B, C: buf.readUInt32LE(e + 8) });
      }
    }
  }
}
allB4.forEach((b) => console.log(`  marker@0x${b.markerOff.toString(16)}: A=${b.A} B=${b.B} C=${b.C}`));

// And B=1 entries (treaty candidate) — should be ~40 in save_10_fresh
console.log(`\n=== save_10_fresh B=1 entries (treaty candidate) ===`);
const allB1 = [];
{
  const buf = fs.readFileSync(path.join(root, "save_10_fresh.sav"));
  const valid = findValidMarkers(buf);
  for (const off of valid) {
    const count = buf.readUInt32LE(off + 4);
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      const B = buf.readUInt32LE(e + 4);
      if (B === 1) {
        allB1.push({ markerOff: off, A: buf.readUInt32LE(e), B, C: buf.readUInt32LE(e + 8) });
      }
    }
  }
}
console.log(`  total B=1 in save_10_fresh: ${allB1.length}`);
console.log(`  examples (first 10):`);
allB1.slice(0, 10).forEach((b) => console.log(`    A=${b.A} C=${b.C}`));
