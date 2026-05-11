// dig-tail5.js — Walk the unit-record array at start of tail and count records.
// Pattern: [u16 nameLen][ASCII name][u8 zero][u32 something][8-byte uuid][...]
//          ...includes UTF-16LE region name after offset+0x2d-ish.
//
// Goal: confirm "tail is an array of armies/units" and count them.
// Also: are these the SAME unit records as in settlement zone? If they were
// merged, total count should match main map army-unit total.

const fs = require("fs");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const buf = fs.readFileSync(SAVE);

const tailStart = 0x1f10c72;
const tailEnd = buf.length;

// Find all unit records: [u16 len ∈ [4..50]][ASCII a-z_]+ in tail
// Anchored by the fact ASCII units always have lowercase + space.
const records = [];
for (let p = tailStart; p + 2 < tailEnd; p++) {
  const len = buf.readUInt16LE(p);
  if (len < 4 || len > 50) continue;
  if (p + 2 + len > tailEnd) continue;
  const s = buf.slice(p + 2, p + 2 + len).toString("ascii");
  // Strict ASCII unit name: lowercase letters + spaces only (+ optional trailing null which is part of length)
  if (!/^[a-z][a-z ]+[a-z]\0?$/.test(s)) continue;
  records.push({ off: p, len, name: s.replace(/\0$/, "") });
}

console.log(`# Unit-name candidate records in tail: ${records.length}\n`);
// Show first 25 and last 5
console.log("First 25:");
for (let i = 0; i < Math.min(25, records.length); i++) {
  const r = records[i];
  console.log(`  [${i.toString().padStart(3)}] @0x${r.off.toString(16)} name=${JSON.stringify(r.name)}`);
}
console.log("\nLast 10:");
for (let i = Math.max(0, records.length - 10); i < records.length; i++) {
  const r = records[i];
  console.log(`  [${i.toString().padStart(3)}] @0x${r.off.toString(16)} name=${JSON.stringify(r.name)}`);
}

// What are the strides between records?
console.log("\nStride histogram between consecutive unit names:");
const strides = {};
for (let i = 1; i < records.length; i++) {
  const d = records[i].off - records[i - 1].off;
  // Round to nearest 4 for bucket
  const bucket = Math.floor(d / 50) * 50;
  strides[bucket] = (strides[bucket] || 0) + 1;
}
const sBucketsSorted = Object.entries(strides).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [b, n] of sBucketsSorted) {
  console.log(`  ~${b}..${parseInt(b) + 49} bytes: ${n}`);
}

// Print stride for first 30 to see the structure
console.log("\nStrides for first 30 pairs:");
for (let i = 1; i < Math.min(30, records.length); i++) {
  const d = records[i].off - records[i - 1].off;
  console.log(`  ${records[i - 1].name} → ${records[i].name}: ${d} bytes`);
}

// Show last record's end + what's after
if (records.length) {
  const last = records[records.length - 1];
  const lastEnd = last.off + 2 + last.len;
  console.log(`\nLast unit record ends at 0x${lastEnd.toString(16)} = name=${last.name}`);
  console.log(`Tail end = 0x${tailEnd.toString(16)}, distance from last unit = ${tailEnd - lastEnd} bytes`);
  // Look at what's right after the last unit name (up to ~256 bytes)
  console.log(`Bytes from last unit end +0..+128:`);
  for (let i = 0; i < 8; i++) {
    const off = lastEnd + i * 16;
    if (off + 16 > tailEnd) break;
    const hex = [];
    const ascii = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    console.log(`  0x${off.toString(16)}: ${hex.join(" ")}  ${ascii.join("")}`);
  }
}

// How many units exist in the settlement zone? Search for "thracian royal bodyguards" total
const needle = Buffer.from("thracian royal bodyguards", "ascii");
let p = 0;
const allHits = [];
while ((p = buf.indexOf(needle, p)) !== -1) {
  allHits.push(p);
  p++;
}
const tailHits = allHits.filter(h => h >= tailStart);
const bodyHits = allHits.filter(h => h < tailStart);
console.log(`\n"thracian royal bodyguards" total: ${allHits.length} (body=${bodyHits.length}, tail=${tailHits.length})`);
