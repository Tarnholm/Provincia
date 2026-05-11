// dig-settle-models3.js — Cross-tab settlement-model coords against in-save settlement list.
// Goal: confirm 213 coords align to settlement count (per session 16, 195 minor + N major from session 3 anchor scan)

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE_ROME10);

function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }

const knownModels = new Set([
  "W_hellenistic_Large_Town","W_hellenistic_Large_City","Celtic_Large_Town",
  "W_hellenistic_City","Eastern_Large_Town","Illyrian_Large_Town",
  "W_hellenistic_Town","Celtic_City","W_hellenistic_Huge_City",
  "Carthaginian_Huge_City","Carthaginian_Large_Town","Eastern_City",
  "Germanic_Large_Town","Nomad_Large_Town","Eastern_Town","Eastern_Huge_City",
  "Carthaginian_City","Egyptian_Large_Town","Celtic_Town","Carthaginian_Town",
  "Egyptian_Town","Illyrian_Town","Germanic_Town","Nomad_Town",
]);

function findAllModels(buf, start, end) {
  const refs = [];
  let p = start;
  while (p + 2 < end) {
    const lenPlus1 = buf.readUInt16LE(p);
    if (lenPlus1 < 9 || lenPlus1 > 30 || p + 2 + lenPlus1 > end) { p++; continue; }
    const strLen = lenPlus1 - 1;
    let ok = true;
    for (let i = 0; i < strLen; i++) {
      if (!isModelChar(buf[p + 2 + i])) { ok = false; break; }
    }
    if (!ok) { p++; continue; }
    if (buf[p + 2 + strLen] !== 0) { p++; continue; }
    const name = buf.slice(p + 2, p + 2 + strLen).toString("ascii");
    if (!knownModels.has(name)) { p++; continue; }
    refs.push({ off: p, lenPlus1, name, postName: p + 2 + lenPlus1 });
    p = p + 2 + lenPlus1;
  }
  return refs;
}

const refs = findAllModels(buf, 0x1f43000, 0x1f95000);

// Build per-coord list
const records = refs.map(r => ({
  ...r,
  tag: buf.readUInt32LE(r.postName),
  x: buf.readUInt32LE(r.postName + 4),
  y: buf.readUInt32LE(r.postName + 8),
}));

// Filter to valid X,Y
const validRecs = records.filter(r => r.tag === 27 || r.tag === 29 || r.tag === 31);
const byCoord = new Map();
for (const r of validRecs) {
  const k = `${r.x},${r.y}`;
  if (!byCoord.has(k)) byCoord.set(k, []);
  byCoord.get(k).push(r);
}
console.log(`Valid records (tag 27/29/31): ${validRecs.length}/${records.length}`);
console.log(`Distinct (X,Y) coords: ${byCoord.size}`);

// Settlement zone per session 14: 0xf88637 .. 0x1f10c72 — get UTF-16LE settlement names
const settlementZoneStart = 0xf88637;
const settlementZoneEnd = 0x1f10c72;
const settNames = new Set();
const settAt = new Map(); // name → list of offsets
for (let p = settlementZoneStart; p + 4 < settlementZoneEnd; p += 1) {
  const len = buf.readUInt16LE(p);
  if (len < 3 || len > 40) continue;
  if (p + 2 + len * 2 > settlementZoneEnd) continue;
  let ok = true;
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  const s = buf.slice(p + 2, p + 2 + len * 2).toString("utf16le");
  if (!/^[A-Z][a-zA-Z]/.test(s)) continue;
  if (s.includes(" ")) continue;
  if (s.length < 4) continue;
  settNames.add(s);
  if (!settAt.has(s)) settAt.set(s, []);
  settAt.get(s).push(p);
  p += 2 + len * 2 - 1;
}
console.log(`Distinct UTF-16LE settlement names in main settlement zone: ${settNames.size}`);

// Also from session 3: settlement count ~ 239 minor + N major
// Note "settlements" here counts EACH unique appearance in zone, may include duplicates per ownership.

// Calculate sizes of multi-entry coord groups and compare to expected (per session 16, 95 of 213 have multiple entries)
const dist = {};
for (const arr of byCoord.values()) {
  const k = arr.length;
  dist[k] = (dist[k] || 0) + 1;
}
console.log(`\n--- Multi-entry distribution ---`);
let totalCoords = 0, totalRecs = 0;
for (const [k, c] of Object.entries(dist).sort((a,b)=>+a[0]-+b[0])) {
  console.log(`  ${k} records: ${c} coords`);
  totalCoords += c;
  totalRecs += +k * c;
}
console.log(`Total coords: ${totalCoords}, total records: ${totalRecs}`);

// The 48-record coord — what is it?
const big = [...byCoord.entries()].sort((a,b) => b[1].length - a[1].length);
console.log(`\n--- Top 10 coords by record count ---`);
for (const [k, arr] of big.slice(0, 10)) {
  const counts = {};
  for (const r of arr) counts[r.name] = (counts[r.name] || 0) + 1;
  const summary = Object.entries(counts).map(([n,c]) => `${n}×${c}`).join(", ");
  console.log(`  (${k}) [${arr.length} records]: ${summary}`);
}

// Pull the 48-record coord's records' offsets
const top1 = big[0];
console.log(`\n--- All 48 records at top coord (${top1[0]}) ---`);
for (const r of top1[1]) {
  console.log(`  off=0x${r.off.toString(16)} name="${r.name}" tag=${r.tag}`);
}

// Distribution of tag types within multi-entry coords
console.log(`\n--- Tag pattern within multi-entry coords ---`);
const tagPatterns = {};
for (const arr of byCoord.values()) {
  if (arr.length < 2) continue;
  const sig = arr.map(r => r.tag).sort().join(",");
  tagPatterns[sig] = (tagPatterns[sig] || 0) + 1;
}
for (const [sig, c] of Object.entries(tagPatterns).sort((a,b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${c} × {${sig}}`);
}

// Question: does the first record at each coord (tag=27) match the current owner's model?
// Get the list of single-entry coords (118) — these are settlements with one consistent owner
const single = [...byCoord.entries()].filter(([k, arr]) => arr.length === 1);
console.log(`\n--- Single-entry coords (${single.length}, all 1 record): tag distribution ---`);
const singleTag = {};
for (const [k, arr] of single) {
  const t = arr[0].tag;
  singleTag[t] = (singleTag[t] || 0) + 1;
}
for (const [t, c] of Object.entries(singleTag).sort((a,b)=>b[1]-a[1])) console.log(`  tag=${t}: ${c}`);
// model histogram
const singleModel = {};
for (const [k, arr] of single) {
  singleModel[arr[0].name] = (singleModel[arr[0].name] || 0) + 1;
}
console.log(`\n--- Single-entry coord model histogram ---`);
for (const [n, c] of Object.entries(singleModel).sort((a,b)=>b[1]-a[1])) console.log(`  ${c.toString().padStart(3)} × ${n}`);

// Map descr_strat coords to the X,Y here — there's regions_large.json with region coords
// Look up descr_strat_buildings or regions_large.json
try {
  const regionsLarge = JSON.parse(fs.readFileSync("C:/dev/Provincia/public/regions_large.json", "utf8"));
  const regionsArr = Array.isArray(regionsLarge) ? regionsLarge : Object.values(regionsLarge);
  console.log(`\n--- regions_large.json has ${regionsArr.length} entries ---`);
  // Look at structure
  if (regionsArr.length > 0) {
    const sample = regionsArr[0];
    console.log("First region keys:", Object.keys(sample).join(", "));
  }
} catch (e) {
  console.log("\nregions_large.json: load failed:", e.message);
}
