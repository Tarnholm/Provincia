// dig-model-strings3.js — Cross-validate settlement model records.
// Are these per-actual-settlement (real cities) or per-army-camp/event?
// Test: count and compare against main settlement zone count.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }

function findAllModels(buf, start, end) {
  const refs = [];
  let p = start;
  while (p + 2 < end) {
    const lenPlus1 = buf.readUInt16LE(p);
    if (lenPlus1 < 9 || lenPlus1 > 40 || p + 2 + lenPlus1 > end) { p++; continue; }
    const strLen = lenPlus1 - 1;
    let ok = true;
    for (let i = 0; i < strLen; i++) {
      if (!isModelChar(buf[p + 2 + i])) { ok = false; break; }
    }
    if (!ok) { p++; continue; }
    if (buf[p + 2 + strLen] !== 0) { p++; continue; }
    const name = buf.slice(p + 2, p + 2 + strLen).toString("ascii");
    if (!/^[A-Z][A-Za-z_]+(_[A-Za-z]+)+$/.test(name)) { p++; continue; }
    refs.push({ off: p, lenPlus1, name, postName: p + 2 + lenPlus1 });
    p = p + 2 + lenPlus1;
  }
  return refs;
}

const refs = findAllModels(buf, 0x1f40000, 0x1f90000);
console.log(`Total settlement refs: ${refs.length}`);

// Settlement zone in main body has UTF-16LE settlement names.
// Per session 14: main settlement zone @ 0xf88637..0x1f10c72.
// Find UTF-16LE settlement names there.
// Just count distinct ones for comparison.

// Approach: find UTF-16LE Pascal-strings in the main settlement zone
// pattern: [u16 charCount][UTF-16LE chars]
const settlementZoneStart = 0xf88637;
const settlementZoneEnd = 0x1f10c72;
const settlementNames = new Set();
for (let p = settlementZoneStart; p + 4 < settlementZoneEnd; p += 1) {
  const len = buf.readUInt16LE(p);
  if (len < 3 || len > 30) continue;
  if (p + 2 + len * 2 > settlementZoneEnd) continue;
  let ok = true;
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(p + 2, p + 2 + len * 2).toString("utf16le");
  // Filter to plausible region names (Capital first letter, mostly letters)
  if (!/^[A-Z][a-zA-Z]/.test(s)) continue;
  if (s.includes(" ")) continue;
  if (s.length < 4) continue;
  settlementNames.add(s);
  p += 2 + len * 2 - 1;  // advance past
}
console.log(`Distinct UTF-16LE settlement names in main zone: ${settlementNames.size}`);

// Spot count: how many descr_regions.txt regions does RIS have? Likely ~200-300.
// 701 settlement records is suspiciously high. Could it be: each settlement has multiple model entries
// (one per battle map size variant)?

// Group rome10 refs by (x, y) — if many at same coord, they're variants for one settlement
const refsWithCoords = refs.map((r, i) => {
  if (i + 1 >= refs.length) return null;
  const x = buf.readUInt32LE(r.postName + 4);
  const y = buf.readUInt32LE(r.postName + 8);
  return { ...r, x, y };
}).filter(r => r);
const byCoord = new Map();
for (const r of refsWithCoords) {
  const k = `${r.x},${r.y}`;
  if (!byCoord.has(k)) byCoord.set(k, []);
  byCoord.get(k).push(r);
}
console.log(`\nDistinct (X,Y) tile coords: ${byCoord.size}`);
const dupCounts = {};
for (const [k, arr] of byCoord) {
  const n = arr.length;
  dupCounts[n] = (dupCounts[n] || 0) + 1;
}
console.log("Settlements with N model entries:");
for (const [n, c] of Object.entries(dupCounts).sort((a,b)=>+a[0]-+b[0])) console.log(`  ${n} models: ${c} coords`);

// Show first 10 coords with multiple entries
const multi = [...byCoord.entries()].filter(([k,arr]) => arr.length > 1).slice(0, 10);
console.log("\n=== Sample coords with multiple model entries ===");
for (const [k, arr] of multi) {
  console.log(`  (${k}): ${arr.map(r => r.name).join(", ")}`);
}

// Are model entries grouped by coord in file order?
// Check: do the refs at coord (257, 333) appear consecutively?
console.log("\n=== Check: are refs at same coord consecutive in file? ===");
// For each multi-entry coord, the refs' indices in refs[]:
for (const [k, arr] of multi.slice(0, 5)) {
  const indices = arr.map(r => refsWithCoords.indexOf(r));
  console.log(`  (${k}): indices = ${indices.join(", ")}`);
}

// Also: tag value u32_0 distribution
const tags = refsWithCoords.map(r => buf.readUInt32LE(r.postName));
const tagHist = {};
for (const t of tags) tagHist[t] = (tagHist[t] || 0) + 1;
console.log("\n=== Tag value (u32_0) histogram ===");
for (const [t, c] of Object.entries(tagHist).sort((a, b) => b[1] - a[1])) {
  console.log(`  tag=${t}: ${c}`);
}
