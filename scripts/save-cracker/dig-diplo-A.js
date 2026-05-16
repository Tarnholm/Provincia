// dig-diplo-A.js — session 108 step A
//
// Step 9 isolated boundary-only diff positions inside major faction records.
// The strongest concentrated cluster is +291..+309 (18 bytes, across most
// majors). Also stride-8 region from +780 to +848.
//
// Goal: dump these specific regions in detail across several saves.
// What is at +291..+309 in major[k]? Is it a 22-entry array of bytes (with
// padding)?
//
// Usage: node dig-diplo-A.js
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "fixtures", "feral");

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}

const SAVES = [
  "save_10_fresh.sav",
  "ror_t1e.sav",
  "ror_t5.sav",
  "ror_t11s.sav",
  "athens_t21.sav",
  "save_1.2.sav",
];

const data = SAVES.map((f) => {
  const buf = fs.readFileSync(path.join(root, f));
  return { name: f, buf, majors: readMajor(buf) };
});

// Show +260..+360 (100 bytes) of major[0..2] across saves
function hex(b, off, len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    if (i % 16 === 0) s += "\n      ";
    s += b[off + i].toString(16).padStart(2, "0") + " ";
  }
  return s;
}

for (let k = 0; k < 3; k++) {
  console.log(`\n=== major[${k}] +260..+359 across saves ===`);
  for (const d of data) {
    if (k >= d.majors.length) continue;
    console.log(`  ${d.name} (regions=${d.majors[k].regions}):${hex(d.buf, d.majors[k].pos + 260, 100)}`);
  }
}

// Show +280..+312 in u32s with diffs highlighted
console.log("\n=== +280..+312 as u32 (8 cells), major[0] across saves ===");
for (const d of data) {
  if (d.majors.length === 0) continue;
  const off = d.majors[0].pos + 280;
  const cells = [];
  for (let c = 0; c < 8; c++) {
    cells.push(d.buf.readUInt32LE(off + c * 4));
  }
  console.log(`  ${d.name}: ${cells.map((v) => v.toString(16).padStart(8, "0")).join(" ")}`);
}

// Show +780..+888 (108 bytes, stride-8) major[0]
console.log("\n=== +780..+888 (stride-8 zone), major[0] ===");
for (const d of data) {
  if (d.majors.length === 0) continue;
  const off = d.majors[0].pos + 780;
  console.log(`  ${d.name}: ${hex(d.buf, off, 108)}`);
}

// And same for major[1]:
console.log("\n=== +280..+360 major[1] ===");
for (const d of data) {
  if (d.majors.length < 2) continue;
  console.log(`  ${d.name} regions=${d.majors[1].regions}:`);
  // u32 view
  for (let off = 280; off < 360; off += 4) {
    const v = d.buf.readUInt32LE(d.majors[1].pos + off);
    process.stdout.write(`    +${off}: 0x${v.toString(16).padStart(8, "0")} (${v})\n`);
  }
}

// Search: does a 22 × N or 23 × N stride-pattern start anywhere in [+200..+1500]?
// Look for a region where the value at +X+k*stride is consistent (small set
// of values) for k=0..21 and stride is N.
console.log("\n\n=== Stride-table candidate search in major[0] (+200..+1500) ===");
const m0 = data.find((d) => d.name === "save_1.2.sav").majors[0];
const buf0 = data.find((d) => d.name === "save_1.2.sav").buf;
for (const stride of [2, 4, 8, 12, 16]) {
  for (const N of [22, 23]) {
    const tableLen = N * stride;
    for (let start = 200; start + tableLen + 8 <= 2000; start += 2) {
      // Read bytes (as stride-byte u32 or u16)
      const vals = [];
      for (let k = 0; k < N; k++) {
        vals.push(buf0.readUInt32LE(m0.pos + start + k * stride));
      }
      // Distinct values count
      const distinct = new Set(vals.map((v) => v & 0xFF));
      if (distinct.size <= 5 && distinct.size > 1) {
        // candidate
        const allLow = vals.every((v) => v < (1 << 24));
        if (allLow) {
          console.log(`  N=${N} stride=${stride} start=+${start}: distinct=${distinct.size} vals=[${vals.map((v) => v & 0xFF).join(",")}]`);
        }
      }
    }
  }
}
