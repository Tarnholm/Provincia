// dig-diplo-HB.js — session 109 step HB
//
// Full hex dump of a 512B window around one "outside" marker. The
// objective: locate exactly the faction-id (or pair) for each marker
// zone.
//
// Usage: node dig-diplo-HB.js
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_10_fresh.sav");
const buf = fs.readFileSync(SAVE);

// First outside marker (the 3rd marker, m[1] @0x154fce5, count=1)
// Surrounding context.
function dump(start, end, base) {
  const N = end - start;
  for (let p = start; p < end; p += 16) {
    const bytes = [];
    const asc = [];
    for (let k = 0; k < 16 && p + k < end; k++) {
      bytes.push(buf[p + k].toString(16).padStart(2, "0"));
      const c = buf[p + k];
      asc.push(c >= 32 && c < 127 ? String.fromCharCode(c) : ".");
    }
    const rel = p - base;
    console.log(`  ${rel >= 0 ? "+" : ""}${rel.toString().padStart(4)} (0x${p.toString(16).padStart(8, "0")}): ${bytes.join(" ")}  ${asc.join("")}`);
  }
}

const markers = [
  { name: "MAJ[0] (1 entry)", off: 0x154e338 },
  { name: "outside #1 (1 entry)", off: 0x154fce5 },
  { name: "outside #2 (1 entry)", off: 0x155168a },
  { name: "outside #3 (41 entries)", off: 0x1554b94 },
  { name: "MAJ[1] (34 entries)", off: 0x158d633 },
];

for (const m of markers) {
  console.log(`\n=== ${m.name} marker @0x${m.off.toString(16)} ===`);
  dump(m.off - 256, m.off + 32, m.off);
}

// For the FIRST marker (major[0]), the record starts at major[0].pos = 0x154e1b8.
// So marker is at recOff+0x180 (= 384). For "outside #1" the record-head
// is somewhere before; let's verify by walking backward to find a header
// pattern.

// HYPOTHESIS: outside markers belong to RECORDS that don't have the
// "u32=100 u32=1 u32=0 u32=0 u32=selfPtr ..." format (which is what the
// 23 majors have). Maybe they have a different format like
// "u32=class_tag u32=version ...".
//
// Let's also examine: each outside marker is INSIDE a known record? They
// are not in major-records (verified). They are not in ff0aaff0 records
// (verified). So they're in some OTHER record family.

// Lets find the "ff" markers immediately PRECEDING each outside marker.
console.log(`\n=== Find preceding 0xff magic bytes for each outside marker ===`);
const outsideOffs = [0x154fce5, 0x155168a, 0x1554b94, 0x178e815, 0x17a029b, 0x17a96c3, 0x17b132e, 0x17b758e];
for (const off of outsideOffs) {
  // Walk backward up to 4KB looking for 0xff 0xff or 0xff bytes
  // Or for a known magic like "f0 0a af f0" or "ff 0a af f0"
  let foundFf = -1;
  let foundF0 = -1;
  for (let p = off - 4096; p < off && p >= 0; p++) {
    if (buf[p] === 0xff && buf[p + 1] === 0x0a && buf[p + 2] === 0xaf && buf[p + 3] === 0xf0) { foundFf = p; }
    if (buf[p] === 0xf0 && buf[p + 1] === 0x0a && buf[p + 2] === 0xaf && buf[p + 3] === 0xf0) { foundF0 = p; }
  }
  console.log(`  marker @0x${off.toString(16)}: nearest ff0aaff0 at 0x${foundFf > 0 ? foundFf.toString(16) : "—"}, nearest f00aaff0 at 0x${foundF0 > 0 ? foundF0.toString(16) : "—"}`);
}
