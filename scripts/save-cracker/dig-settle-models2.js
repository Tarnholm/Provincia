// dig-settle-models2.js — Full sub-structure mapping of the settlement-model block.
// Refine block start/end. For each record dump: header → ASCII name → payload up to next record.
// Then: histogram of record sizes, exact record stride for each (X,Y) tile coord.

const fs = require("fs");

const SAVE_ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";

const buf = fs.readFileSync(SAVE_ROME10);

function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }

// All 24 known model names
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
console.log(`Found ${refs.length} model refs`);
console.log(`First @0x${refs[0].off.toString(16)} = "${refs[0].name}"`);
console.log(`Last  @0x${refs[refs.length-1].off.toString(16)} = "${refs[refs.length-1].name}"`);

// What lies just before the first ref and just after the last ref's record-end?
// First ref @0x1f47809: look back 256 bytes
console.log(`\n--- 64 bytes before first ref @0x${refs[0].off.toString(16)} ---`);
const preStart = refs[0].off - 64;
for (let i = 0; i < 64; i += 16) {
  const off = preStart + i;
  const slice = buf.slice(off, off + 16);
  const hex = [...slice].map(b => b.toString(16).padStart(2,"0")).join(" ");
  const ascii = [...slice].map(b => (b >= 0x20 && b < 0x7e) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}`);
}

// Compute distance from last ref to a likely "end of block" marker
// Last ref ends at last.postName + N bytes. Look for next pattern transition.
const last = refs[refs.length - 1];
console.log(`\n--- 256 bytes after last ref @0x${last.off.toString(16)} (postName=0x${last.postName.toString(16)}) ---`);
for (let i = 0; i < 256; i += 16) {
  const off = last.postName + i;
  const slice = buf.slice(off, off + 16);
  const hex = [...slice].map(b => b.toString(16).padStart(2,"0")).join(" ");
  const ascii = [...slice].map(b => (b >= 0x20 && b < 0x7e) ? String.fromCharCode(b) : ".").join("");
  console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}`);
}

// Distance histogram between consecutive refs (= record size)
const deltas = [];
for (let i = 1; i < refs.length; i++) {
  deltas.push(refs[i].off - refs[i-1].off);
}
const dHist = {};
for (const d of deltas) dHist[d] = (dHist[d] || 0) + 1;
const dSorted = Object.entries(dHist).sort((a,b) => b[1] - a[1]);
console.log(`\n--- Record-size histogram (delta between consecutive ref offsets) ---`);
for (const [d, c] of dSorted.slice(0, 15)) console.log(`  ${d.padStart(5)} B: ${c}`);
console.log(`  Total deltas: ${deltas.length}`);
console.log(`  Min: ${Math.min(...deltas)}, Max: ${Math.max(...deltas)}`);

// For each record, parse payload as u32s; collect first u32 (tag) and pos 4..8 (X), 8..12 (Y)
const records = [];
for (let i = 0; i < refs.length; i++) {
  const r = refs[i];
  const nextOff = (i + 1 < refs.length) ? refs[i+1].off : refs[i].postName + 64;
  const recLen = nextOff - r.off;
  const u32_0 = buf.readUInt32LE(r.postName);
  const u32_1 = buf.readUInt32LE(r.postName + 4);
  const u32_2 = buf.readUInt32LE(r.postName + 8);
  const u32_3 = buf.readUInt32LE(r.postName + 12);
  const u32_4 = buf.readUInt32LE(r.postName + 16);
  records.push({ ...r, recLen, tag: u32_0, x: u32_1, y: u32_2, u32_3, u32_4 });
}

// Block size in bytes from first ref to last ref end
const blockStart = refs[0].off;
const blockEnd = records[records.length - 1].off + records[records.length - 1].recLen;
console.log(`\n--- Block bounds ---`);
console.log(`  Start: 0x${blockStart.toString(16)}`);
console.log(`  End:   0x${blockEnd.toString(16)}`);
console.log(`  Size:  ${blockEnd - blockStart} bytes (${((blockEnd - blockStart)/1024).toFixed(1)} KB)`);

// Tag histogram
const tagHist = {};
for (const r of records) tagHist[r.tag] = (tagHist[r.tag] || 0) + 1;
console.log(`\n--- Tag u32_0 histogram ---`);
for (const [t, c] of Object.entries(tagHist).sort((a,b) => b[1] - a[1])) {
  console.log(`  tag=${t} (0x${(+t).toString(16)}): ${c}`);
}

// Now look at X,Y range
const xs = records.map(r => r.x).filter(x => x >= 1 && x <= 2000);
const ys = records.map(r => r.y).filter(y => y >= 1 && y <= 2000);
console.log(`\n--- X,Y range ---`);
console.log(`  X: [${Math.min(...xs)} .. ${Math.max(...xs)}], n=${xs.length}`);
console.log(`  Y: [${Math.min(...ys)} .. ${Math.max(...ys)}], n=${ys.length}`);

// Distinct (X,Y) coord
const byCoord = new Map();
for (const r of records) {
  const k = `${r.x},${r.y}`;
  if (!byCoord.has(k)) byCoord.set(k, []);
  byCoord.get(k).push(r);
}
console.log(`Distinct (X,Y): ${byCoord.size}`);

// Distribution of N model entries per coord
const nDist = {};
for (const arr of byCoord.values()) {
  const n = arr.length;
  nDist[n] = (nDist[n] || 0) + 1;
}
console.log(`\n--- Multi-entry histogram (N coords with K records) ---`);
for (const [n, c] of Object.entries(nDist).sort((a,b)=>+a[0]-+b[0])) console.log(`  ${n} entries: ${c} coords`);

// Sample 10 first records with full payload up to recLen
console.log(`\n--- First 5 record full payload ---`);
for (let i = 0; i < 5; i++) {
  const r = records[i];
  console.log(`\n[${i}] off=0x${r.off.toString(16)} name="${r.name}" recLen=${r.recLen} tag=${r.tag} X=${r.x} Y=${r.y} u3=${r.u32_3} u4=${r.u32_4}`);
  const payloadStart = r.postName;
  const payloadEnd = r.off + r.recLen;
  const numU32 = Math.min(20, Math.floor((payloadEnd - payloadStart) / 4));
  for (let j = 0; j < numU32; j++) {
    const off = payloadStart + j * 4;
    const v = buf.readUInt32LE(off);
    const vSigned = v >= 0x80000000 ? v - 0x100000000 : v;
    console.log(`  payload[${j}] @0x${off.toString(16)} = ${v} (0x${v.toString(16).padStart(8,"0")}) signed=${vSigned}`);
  }
  // Hex dump
  const dumpLen = Math.min(payloadEnd - payloadStart, 80);
  for (let k = 0; k < dumpLen; k += 16) {
    const slice = buf.slice(payloadStart + k, Math.min(payloadStart + k + 16, payloadEnd));
    const hex = [...slice].map(b => b.toString(16).padStart(2,"0")).join(" ");
    const ascii = [...slice].map(b => (b >= 0x20 && b < 0x7e) ? String.fromCharCode(b) : ".").join("");
    console.log(`    0x${(payloadStart+k).toString(16)}: ${hex.padEnd(48)}  ${ascii}`);
  }
}
