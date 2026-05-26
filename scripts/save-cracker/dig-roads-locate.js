// dig-roads-locate.js — locate the road / port / watchtower entity arrays.
//
// Strategy: scan each save's known structural zones for repetitive small-stride
// record tables with cardinality close to the dev-image targets:
//   roads = 3,957  ports = 1,276  watchtowers = 363
//
// We don't know the byte layout yet, but the engine ALWAYS lays entities out
// as a count-prefixed array of fixed-size records (the unit / character /
// settlement parsers all rely on that). So if we count fixed-stride records in
// each known zone, the cardinalities should pop out.
//
// Zones to probe (per cover.js):
//   * post-fow-35-stride-table  0x44e2..0x2a25d  (~155 KB)
//   * diplo-slot-table          0x2d4a9..0x61c47 (~214 KB; session 56)
//   * ZoneA-log-slots           0x61c47..0x846af (~142 KB)
//   * ZoneB-scripted-events     0x846af..0xa8beb (~150 KB)
//   * post-tile-grid blob       0xf85f5c..(end of 267-stride array)
//   * Tile-grid matrix          0xf8fd2..0xf84632 (now known as diplo matrix)
//
// For each zone, walk all strides 4..64 and count how many records carry a
// stable u32-aligned pattern. Print top stride/cardinality matches.
//
// Usage: node dig-roads-locate.js [savePath]
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const buf = fs.readFileSync(SAVE);
console.log(`save: ${SAVE} (${buf.length} B)`);

const ZONES = [
  ["post-fow-35-stride-table",  0x44e2,    0x2a25d],
  ["diplo-event-log",           0x2a25d,   0x2d4a9],
  ["diplo-slot-table",          0x2d4a9,   0x61c47],
  ["ZoneA-log-slots",           0x61c47,   0x846af],
  ["ZoneB-scripted-events",     0x846af,   0xa8beb],
  ["character-paths",           0xa8beb,   0xf8fd2],
];

const TARGETS = { roads: 3957, ports: 1276, watchtowers: 363 };

// For each zone, try various stride values and see if count ≈ any target.
function probe(name, start, end) {
  const span = end - start;
  console.log(`\n=== ${name} (0x${start.toString(16)}..0x${end.toString(16)}, ${span} B) ===`);
  // Try strides — see which closely match a target if we treat the whole zone as one table.
  const candidates = [];
  for (let s = 4; s <= 256; s += 1) {
    if (span % s === 0) candidates.push({ stride: s, n: span / s });
  }
  // Find closest match to each target.
  for (const [k, tgt] of Object.entries(TARGETS)) {
    let best = null;
    for (const c of candidates) {
      const diff = Math.abs(c.n - tgt);
      if (!best || diff < best.diff) best = { ...c, diff };
    }
    if (best) console.log(`  ${k}=${tgt}: closest stride=${best.stride}, n=${best.n} (diff ${best.diff})`);
  }
  // Also: enumerate strides that yield n=N approximately
  for (const [k, tgt] of Object.entries(TARGETS)) {
    const matchStrides = candidates.filter(c => Math.abs(c.n - tgt) < tgt * 0.02);
    if (matchStrides.length) {
      console.log(`  strides within 2% of ${k}=${tgt}: ${matchStrides.map(c => `${c.stride}B×${c.n}`).join(", ")}`);
    }
  }
}

for (const [n, a, b] of ZONES) probe(n, a, b);

// Bonus: look for explicit count headers — scan for a u32 == target value.
console.log("\n=== Searching for u32 fields matching target counts ===");
for (const [k, tgt] of Object.entries(TARGETS)) {
  const tb = Buffer.alloc(4); tb.writeUInt32LE(tgt);
  let p = 0, count = 0; const hits = [];
  while ((p = buf.indexOf(tb, p)) >= 0) {
    if (p < 0x1000000) hits.push(p);
    count++;
    p += 1;
  }
  console.log(`  ${k}=${tgt} (LE bytes ${tb.toString("hex")}): ${count} hits in file; first body hits: ${hits.slice(0,10).map(h=>"0x"+h.toString(16)).join(", ")}`);
}
