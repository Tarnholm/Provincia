// Confirm character X/Y field generalizes across factions, and confirm
// region-id field by checking 1049 → 1072 transition in Leonidas's record.
//
// baseline: savestartsparta.sav (Leonidas at 398, 337 region 1049)
// variant:  save_1.3.sav        (Leonidas at 400, 335 region 1072)
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_1.3.sav"));

console.log(`baseline: ${a.length.toLocaleString()}  save_1.3: ${b.length.toLocaleString()}  Δ=${b.length - a.length}\n`);

// Step 1: scan for u16 X/Y co-occurrence
function indexU16(buf, value) {
  const out = [];
  for (let i = 0; i + 2 <= buf.length; i++) if (buf.readUInt16LE(i) === value) out.push(i);
  return out;
}

const a398 = indexU16(a, 398);
const a337 = indexU16(a, 337);
const b400 = indexU16(b, 400);
const b335 = indexU16(b, 335);
const a1049 = indexU16(a, 1049);
const b1072 = indexU16(b, 1072);

console.log(`X 398 in baseline: ${a398.length} matches`);
console.log(`Y 337 in baseline: ${a337.length} matches`);
console.log(`X 400 in save_1.3: ${b400.length} matches`);
console.log(`Y 335 in save_1.3: ${b335.length} matches`);
console.log(`region 1049 in baseline: ${a1049.length} matches`);
console.log(`region 1072 in save_1.3: ${b1072.length} matches`);

// Step 2: Test the +14 X→Y pattern from Azes
console.log(`\n=== Testing X@O, Y@O+14 pattern (Azes-style) ===`);
const a398Set = new Set(a398);
const aPairs14 = [];
for (const o of a398) if (o + 14 < a.length && a.readUInt16LE(o + 14) === 337) aPairs14.push(o);
console.log(`baseline: ${aPairs14.length} positions where u16@O=398 AND u16@O+14=337`);

const b400Set = new Set(b400);
const bPairs14 = [];
for (const o of b400) if (o + 14 < b.length && b.readUInt16LE(o + 14) === 335) bPairs14.push(o);
console.log(`save_1.3: ${bPairs14.length} positions where u16@O=400 AND u16@O+14=335`);

// Step 3: Cross-correlation — find the offset that holds (398,337) in baseline
// AND the same offset (with shift tolerance) holds (400,335) in save_1.3
console.log(`\n=== Cross-correlation across baseline ↔ save_1.3 ===`);
const b400Set2 = new Set(b400);
const confirmed = [];
for (const aOff of aPairs14) {
  for (let s = -512; s <= 512; s++) {
    const bOff = aOff + s;
    if (!b400Set2.has(bOff)) continue;
    if (bOff + 14 >= b.length) continue;
    if (b.readUInt16LE(bOff + 14) !== 335) continue;
    confirmed.push({ aOff, bOff, shift: s });
    break;
  }
}
console.log(`X@O=398→400 AND Y@O+14=337→335 confirmed at ${confirmed.length} location(s):`);
for (const c of confirmed) {
  console.log(`  baseline @0x${c.aOff.toString(16)}, save_1.3 @0x${c.bOff.toString(16)}, shift=${c.shift}`);
}

// Step 4: try the +2 stride too (smaller record)
console.log(`\n=== Testing X@O, Y@O+2 pattern (12-byte-record candidate) ===`);
const aPairs2 = [];
for (const o of a398) if (o + 2 < a.length && a.readUInt16LE(o + 2) === 337) aPairs2.push(o);
console.log(`baseline: ${aPairs2.length} positions where u16@O=398 AND u16@O+2=337`);
const bPairs2 = [];
for (const o of b400) if (o + 2 < b.length && b.readUInt16LE(o + 2) === 335) bPairs2.push(o);
console.log(`save_1.3: ${bPairs2.length} positions where u16@O=400 AND u16@O+2=335`);

const b400Set3 = new Set(b400);
const confirmed2 = [];
for (const aOff of aPairs2) {
  for (let s = -512; s <= 512; s++) {
    const bOff = aOff + s;
    if (!b400Set3.has(bOff)) continue;
    if (bOff + 2 >= b.length) continue;
    if (b.readUInt16LE(bOff + 2) !== 335) continue;
    confirmed2.push({ aOff, bOff, shift: s });
    break;
  }
}
console.log(`X@O=398→400 AND Y@O+2=337→335 confirmed at ${confirmed2.length} location(s):`);
for (const c of confirmed2) {
  console.log(`  baseline @0x${c.aOff.toString(16)}, save_1.3 @0x${c.bOff.toString(16)}, shift=${c.shift}`);
}

// Step 5: For each confirmed location, look for region 1049 → 1072 within ±256B
console.log(`\n=== Searching for region 1049→1072 near each confirmed (X,Y) ===`);
const allConfirmed = [...confirmed, ...confirmed2];
for (const c of allConfirmed) {
  const lo = Math.max(0, c.aOff - 256);
  const hi = Math.min(a.length - 2, c.aOff + 256);
  for (let i = lo; i <= hi; i++) {
    if (a.readUInt16LE(i) !== 1049) continue;
    // Check the same relative offset in save_1.3
    const bI = i + c.shift;
    if (bI < 0 || bI + 2 > b.length) continue;
    if (b.readUInt16LE(bI) === 1072) {
      console.log(`  *** match: region @0x${i.toString(16)} (baseline 1049) / @0x${bI.toString(16)} (save_1.3 1072), Δ from X = ${i - c.aOff} bytes`);
    }
  }
}

// Step 6: byte-dump around the strongest confirmed location, baseline only
if (allConfirmed.length > 0) {
  const c = allConfirmed[0];
  console.log(`\n=== Dump 32B before to 64B after strongest confirmed offset (baseline) ===`);
  for (let row = -32; row < 64; row += 16) {
    const o = c.aOff + row;
    if (o < 0 || o + 16 > a.length) continue;
    let line = `Δ${String(row).padStart(4)}  0x${o.toString(16).padStart(8,"0")}  `;
    for (let cb = 0; cb < 16; cb++) line += `${a[o + cb].toString(16).padStart(2,"0")} `;
    line += "  ";
    for (let cb = 0; cb < 16; cb++) {
      const v = a[o + cb];
      line += (v >= 0x20 && v <= 0x7e) ? String.fromCharCode(v) : ".";
    }
    line += "  u16:";
    for (let u = 0; u < 16; u += 2) line += String(a.readUInt16LE(o + u)).padStart(6) + ",";
    console.log(line);
  }
}
