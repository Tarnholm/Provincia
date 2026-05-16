// dig-mp11.js — full-file scan of per-character position records, plus
// before-vs-after diff verification.
//
// Method:
//   1. Parse characters in BEFORE save → collect secondaryUuid set.
//   2. Scan whole file for u32 hits matching that set.
//   3. For each hit, read x@+8, y@+12, mp_f32@+58 (unaligned).
//   4. Filter: x,y in 1..500, mp finite in 0..500.
//   5. Compare against AFTER save at same offsets; print every diff.
//
// Expected: exactly one diff — Manius Aemilius_Paullus moving y=425→424
// and mp 248.0→239.2.

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const { findCharacterRecords } = require(path.join(PROVINCIA_SRC, "characterParser.js"));

const bufB = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_before.sav");
const bufA = fs.readFileSync("C:/Users/vtarn/Downloads/save_mp_after.sav");

const MOD = "C:/RIS/RIS/data";
const names = fs.readFileSync(MOD + "/descr_names_lookup.txt", "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const l of fs.readFileSync(MOD + "/export_descr_character_traits.txt", "utf8").split(/\r?\n/)) {
  const m = l.match(/^Trait\s+(\S+)/); if (m) traits.push(m[1]);
}

const chars = findCharacterRecords(bufB, names, traits, null);
console.log("characters:", chars.length);

const uuidToChar = new Map();
for (const c of chars) {
  if (c.secondaryUuid && c.secondaryUuid !== 0xffffffff) {
    if (!uuidToChar.has(c.secondaryUuid)) uuidToChar.set(c.secondaryUuid, c);
  }
}

// Full scan
const records = [];
for (let i = 100; i < bufB.length - 64; i++) {
  const u = bufB.readUInt32LE(i);
  if (!uuidToChar.has(u)) continue;
  const x = bufB.readUInt32LE(i + 8);
  const y = bufB.readUInt32LE(i + 12);
  if (x < 1 || x > 500 || y < 1 || y > 500) continue;
  const mp = bufB.readFloatLE(i + 58);
  if (!isFinite(mp) || mp < 0 || mp > 500) continue;
  records.push({ at: i, uuid: u, x, y, mp, char: uuidToChar.get(u) });
}
console.log("pos record candidates:", records.length);

let diffCount = 0;
for (const r of records) {
  const mpA = bufA.readFloatLE(r.at + 58);
  const xA = bufA.readUInt32LE(r.at + 8);
  const yA = bufA.readUInt32LE(r.at + 12);
  if (mpA !== r.mp || xA !== r.x || yA !== r.y) {
    diffCount++;
    const name = r.char ? `${r.char.firstName} ${r.char.lastName||""}` : "(unknown)";
    console.log(`  CHANGE: ${name} at 0x${r.at.toString(16)}  pos (${r.x},${r.y})→(${xA},${yA})  MP ${r.mp.toFixed(3)}→${mpA.toFixed(3)} (Δ${(mpA-r.mp).toFixed(3)})`);
  }
}
console.log("\nrecords with ANY diff:", diffCount);

// MP histogram
console.log("\nMP histogram (BEF):");
const bins = new Map();
for (const r of records) {
  const k = Math.round(r.mp);
  bins.set(k, (bins.get(k) || 0) + 1);
}
for (const [k, v] of [...bins.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  mp=${k}: ${v}`);
}
