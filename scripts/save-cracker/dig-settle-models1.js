// dig-settle-models1.js — Map the 290KB settlement-model strings block fully.
// Goals:
//   1. Exact start/end offsets in rome10 (refining session-16 estimate)
//   2. Enumerate distinct strings + grouped histograms (settlement vs UI vs other)
//   3. Cross-tabulate against in-save settlement count (cross-validated from session-3 UTF-16 anchor scan)

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const SAVE_ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

// Per session 14: block ~ 0x1f47abd .. 0x1f8f97b (290KB)
// Per session 16: block actually starts before 0x1f47abd; widen scan

function isAsciiPrintable(b) { return b >= 0x20 && b <= 0x7e; }
function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }

// Enumerate ALL ASCII Pascal strings with [u16 lenPlus1][lenPlus1-1 bytes][0x00]
function findAllAsciiPascal(buf, start, end, minLen=4, maxLen=80) {
  const refs = [];
  let p = start;
  while (p + 2 < end) {
    const lenPlus1 = buf.readUInt16LE(p);
    if (lenPlus1 < minLen + 1 || lenPlus1 > maxLen + 1 || p + 2 + lenPlus1 > end) { p++; continue; }
    const strLen = lenPlus1 - 1;
    let ok = true;
    for (let i = 0; i < strLen; i++) {
      if (!isAsciiPrintable(buf[p + 2 + i])) { ok = false; break; }
    }
    if (!ok) { p++; continue; }
    if (buf[p + 2 + strLen] !== 0) { p++; continue; }
    const name = buf.slice(p + 2, p + 2 + strLen).toString("ascii");
    refs.push({ off: p, lenPlus1, name });
    p = p + 2 + lenPlus1;
  }
  return refs;
}

for (const [label, savePath, scanStart, scanEnd] of [
  ["rome10", SAVE_ROME10, 0x1f43000, 0x1f95000],
  ["RoR-T1", SAVE_ROR_T1, 0x1f10000, 0x1f80000],
]) {
  console.log(`\n========= ${label} =========`);
  const buf = fs.readFileSync(savePath);
  console.log(`Save size: ${buf.length} bytes (0x${buf.length.toString(16)})`);

  // Find ALL printable-ASCII Pascal strings in the suspected block
  const strs = findAllAsciiPascal(buf, scanStart, scanEnd);
  console.log(`Total ASCII Pascal strings found in [0x${scanStart.toString(16)}..0x${scanEnd.toString(16)}]: ${strs.length}`);

  // First and last
  if (strs.length > 0) {
    console.log(`First string @0x${strs[0].off.toString(16)}: "${strs[0].name}"`);
    console.log(`Last  string @0x${strs[strs.length-1].off.toString(16)}: "${strs[strs.length-1].name}"`);
  }

  // Group by name
  const byName = new Map();
  for (const s of strs) {
    if (!byName.has(s.name)) byName.set(s.name, 0);
    byName.set(s.name, byName.get(s.name) + 1);
  }
  console.log(`\nDistinct strings: ${byName.size}`);

  // Top by count
  const sorted = [...byName.entries()].sort((a,b) => b[1] - a[1]);
  console.log(`\nTop 40 most common strings:`);
  for (const [n, c] of sorted.slice(0, 40)) {
    console.log(`  ${c.toString().padStart(4)} × "${n}"`);
  }

  // Categorize:
  // - settlement model = looks like "W_hellenistic_City", "Celtic_Town", etc.
  //   (capitalized words + underscore + city/town/villag etc.)
  // - SE-marker = starts with "se_"
  // - other = anything else
  const settlement = [];
  const seMarker = [];
  const other = [];
  for (const [n, c] of byName) {
    if (/^[A-Z][A-Za-z]+(_[A-Z][A-Za-z]+)*(_(Town|City|Hamlet|Large_Town|Huge_City|Village|Capital))?$/.test(n)) {
      settlement.push([n, c]);
    } else if (/^se_/.test(n)) {
      seMarker.push([n, c]);
    } else {
      other.push([n, c]);
    }
  }

  console.log(`\n--- Categorization ---`);
  console.log(`Settlement-model-pattern: ${settlement.length} distinct, ${settlement.reduce((s,[_,c])=>s+c,0)} refs`);
  console.log(`se_* prefix:               ${seMarker.length} distinct, ${seMarker.reduce((s,[_,c])=>s+c,0)} refs`);
  console.log(`Other:                     ${other.length} distinct, ${other.reduce((s,[_,c])=>s+c,0)} refs`);

  console.log(`\n--- All settlement-pattern strings (count, name) ---`);
  for (const [n, c] of settlement.sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${c.toString().padStart(4)} × ${n}`);
  }

  if (seMarker.length > 0) {
    console.log(`\n--- All se_* strings ---`);
    for (const [n, c] of seMarker.sort((a,b)=>b[1]-a[1])) {
      console.log(`  ${c.toString().padStart(4)} × ${n}`);
    }
  }

  if (other.length > 0 && other.length <= 30) {
    console.log(`\n--- All "other" strings ---`);
    for (const [n, c] of other.sort((a,b)=>b[1]-a[1])) {
      console.log(`  ${c.toString().padStart(4)} × ${n}`);
    }
  }
}
