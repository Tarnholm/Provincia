// Targeted dig for Azes's coordinate field, using the manifest's exact values:
//   baseline: x=921, y=643
//   save_7:   x=917, y=645
//   delta:    Δx=-4, Δy=+2
//
// Strategy:
//   1. Find every byte offset where "Azes" appears in the baseline (cstring)
//   2. For each occurrence, scan ±2KB looking for the four target integers in
//      every numeric width (u8/i8/u16/i16/u32/i32/f32). Record matches.
//   3. Repeat for save_7. The offset where 921 is in baseline AND 917 is in
//      save_7 — at the same delta from "Azes" — is the position field.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const baselinePath = path.join(SAVE_DIR, "save_1turnstart.sav");
const variantPath  = path.join(SAVE_DIR, "save_7.sav");

const a = fs.readFileSync(baselinePath);
const b = fs.readFileSync(variantPath);

console.log(`baseline: ${a.length.toLocaleString()} bytes`);
console.log(`variant7: ${b.length.toLocaleString()} bytes`);

// Find every "Azes" cstring + utf16le occurrence
function findAll(buf, needle) {
  const hits = [];
  let from = 0;
  while (true) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
  }
  return hits;
}

function utf16le(s) {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16LE(s.charCodeAt(i), i * 2);
  return b;
}
const azes_utf8 = Buffer.from("Azes", "utf-8");
const azes_u16  = utf16le("Azes");
const azes_u8L  = Buffer.from("azes", "utf-8");
console.log(`probe encodings: utf-8 "Azes", utf-16le "Azes", utf-8 "azes"`);
let aHits = findAll(a, azes_utf8);
let bHits = findAll(b, azes_utf8);
console.log(`utf-8 "Azes" hits — baseline: ${aHits.length}, variant7: ${bHits.length}`);
const aHits16 = findAll(a, azes_u16);
const bHits16 = findAll(b, azes_u16);
console.log(`utf-16le "Azes" hits — baseline: ${aHits16.length}, variant7: ${bHits16.length}`);
const aHitsL = findAll(a, azes_u8L);
const bHitsL = findAll(b, azes_u8L);
console.log(`utf-8 "azes" lowercase hits — baseline: ${aHitsL.length}, variant7: ${bHitsL.length}`);

// Use whichever encoding hit
if (aHits.length === 0 && aHits16.length > 0) { aHits = aHits16; bHits = bHits16; console.log(`→ using UTF-16LE encoding`); }
else if (aHits.length === 0 && aHitsL.length > 0) { aHits = aHitsL; bHits = bHitsL; console.log(`→ using lowercase encoding`); }
else if (aHits.length > 0) console.log(`→ using UTF-8 encoding`);

if (aHits.length === 0) {
  // Fall back: try any character name from descr_strat that appears in the file
  console.log(`\n(none found — searching any Saka character name from descr_strat)`);
  const stratText = fs.readFileSync("C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_strat.txt", "utf-8");
  const sakaSection = stratText.match(/^faction\s+saka[\s\S]+?(?=^faction\s+\w|^character_record\s)/m);
  if (sakaSection) {
    const names = [];
    for (const m of sakaSection[0].matchAll(/^character[,\s]\s*([^,\n]+),/gm)) names.push(m[1].trim());
    console.log(`  Saka characters in descr_strat: ${names.join(", ")}`);
    for (const n of names) {
      const u8 = Buffer.from(n, "utf-8");
      const u16 = utf16le(n);
      const h8 = findAll(a, u8).length;
      const h16 = findAll(a, u16).length;
      console.log(`  "${n}" — utf8: ${h8}, utf16le: ${h16}`);
    }
  } else {
    console.log("  (couldn't isolate Saka section in descr_strat)");
  }
  process.exit(0);
}

// Look around each hit for our known integers
function scanAround(buf, off, label) {
  const lo = Math.max(0, off - 2048);
  const hi = Math.min(buf.length - 4, off + 2048);
  const matches = [];
  for (let i = lo; i <= hi; i++) {
    if (i + 2 <= buf.length) {
      const u16 = buf.readUInt16LE(i);
      if (u16 === 921 || u16 === 643 || u16 === 917 || u16 === 645) matches.push({ at: i, val: u16, w: "u16le", deltaFromAzes: i - off });
    }
    if (i + 4 <= buf.length) {
      const u32 = buf.readUInt32LE(i);
      if (u32 === 921 || u32 === 643 || u32 === 917 || u32 === 645) matches.push({ at: i, val: u32, w: "u32le", deltaFromAzes: i - off });
      const f = buf.readFloatLE(i);
      if (Number.isFinite(f)) {
        const fInt = Math.round(f);
        if (Math.abs(f - fInt) < 0.01 && [921, 643, 917, 645].includes(fInt)) {
          matches.push({ at: i, val: f, w: "f32le", deltaFromAzes: i - off });
        }
      }
    }
  }
  return matches;
}

console.log(`\n=== Baseline scan around "Azes" ===`);
for (const off of aHits.slice(0, 4)) {
  console.log(`Azes @0x${off.toString(16)} — context:`);
  const m = scanAround(a, off, "baseline");
  if (m.length === 0) { console.log(`  (no 921/643/917/645 within ±2KB in any of u16/u32/f32)`); continue; }
  for (const x of m.slice(0, 30)) {
    console.log(`  Δ=${String(x.deltaFromAzes).padStart(6)}  @0x${x.at.toString(16).padStart(8,"0")}  val=${x.val}  ${x.w}`);
  }
}

console.log(`\n=== Variant7 scan around "Azes" ===`);
for (const off of bHits.slice(0, 4)) {
  console.log(`Azes @0x${off.toString(16)} — context:`);
  const m = scanAround(b, off, "variant7");
  if (m.length === 0) { console.log(`  (no 921/643/917/645 within ±2KB in any of u16/u32/f32)`); continue; }
  for (const x of m.slice(0, 30)) {
    console.log(`  Δ=${String(x.deltaFromAzes).padStart(6)}  @0x${x.at.toString(16).padStart(8,"0")}  val=${x.val}  ${x.w}`);
  }
}

// Cross-correlation: find the Azes hit that has BOTH 921 and 643 nearby in
// baseline, AND 917 and 645 nearby at the SAME deltas in variant7.
console.log(`\n=== Cross-correlation: same Δ from Azes in BOTH saves ===`);
function targetMap(buf, hits, targetX, targetY) {
  // For each Azes hit, return { hit, xMatches, yMatches }
  return hits.map(h => {
    const m = scanAround(buf, h, "");
    return {
      hit: h,
      xMatches: m.filter(x => Math.round(typeof x.val === "number" ? x.val : 0) === targetX),
      yMatches: m.filter(x => Math.round(typeof x.val === "number" ? x.val : 0) === targetY),
    };
  });
}
const aMap = targetMap(a, aHits, 921, 643);
const bMap = targetMap(b, bHits, 917, 645);
// Pair up by ordinal occurrence — the Nth Azes in baseline corresponds to the
// Nth Azes in variant7 if the file shape is preserved (it should be, with
// only the move action between them).
const limit = Math.min(aMap.length, bMap.length);
let confirmed = 0;
for (let i = 0; i < limit; i++) {
  const av = aMap[i], bv = bMap[i];
  // For each baseline xMatch, see if variant7 has 917 at the same delta
  for (const ax of av.xMatches) {
    const match917 = bv.xMatches.find(bx => bx.deltaFromAzes === ax.deltaFromAzes && bx.w === ax.w);
    if (!match917) continue;
    // Also check y at delta+4 (typical adjacency) or any nearby delta
    const yCandidates = av.yMatches.filter(ay => Math.abs(ay.deltaFromAzes - ax.deltaFromAzes) <= 8);
    for (const ay of yCandidates) {
      const match645 = bv.yMatches.find(by => by.deltaFromAzes === ay.deltaFromAzes && by.w === ay.w);
      if (!match645) continue;
      console.log(`  *** Azes #${i} @baseline=0x${av.hit.toString(16)} variant=0x${bv.hit.toString(16)}`);
      console.log(`      X field: Δ=${ax.deltaFromAzes} (${ax.w}), 921 → 917`);
      console.log(`      Y field: Δ=${ay.deltaFromAzes} (${ay.w}), 643 → 645`);
      console.log(`      → X at 0x${ax.at.toString(16)} (baseline) / 0x${match917.at.toString(16)} (variant)`);
      console.log(`      → Y at 0x${ay.at.toString(16)} (baseline) / 0x${match645.at.toString(16)} (variant)`);
      confirmed++;
    }
  }
}
console.log(`\n${confirmed} confirmed (X,Y) field locations near "Azes" string occurrences.`);
