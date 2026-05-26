// dig-watchtower-table.js — found a stride-40 table at ~0x1875cbd that
// contains exactly the 22 descr_strat starting watchtower coords. Now:
//   (1) Dump the full table structure to find its boundaries
//   (2) Identify how many records the table has total
//   (3) Look for additional tables (built watchtowers come from gameplay)
//   (4) Cross-check with T960 (~363 dev count region of save history)

"use strict";
const fs = require("fs");
const path = require("path");

const SAVES = [
  ["t960-start",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1017",          "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

// Anchor offset per save (the first descr_strat coord (698,317))
const ANCHORS = {
  "t960-start":  0x186c031,
  "t1017":       0x1875cbd,
  "t1018-start": 0x1875f10,
};

for (const [tag, savePath] of SAVES) {
  const buf = fs.readFileSync(savePath);
  const anchor = ANCHORS[tag];
  console.log(`\n========= ${tag} =========`);
  console.log(`Anchor (first WT coord): 0x${anchor.toString(16)}`);

  // Step 1: Dump the 40-byte records starting at anchor. Show 25 records.
  console.log(`\nFirst 25 records (40-byte stride, from anchor):`);
  for (let i = 0; i < 25; i++) {
    const p = anchor + i * 40;
    if (p + 40 > buf.length) break;
    const slice = buf.slice(p, p + 40);
    const x = slice.readUInt32LE(0);
    const y = slice.readUInt32LE(4);
    const hex = slice.toString("hex").match(/.{2}/g).join(" ");
    console.log(`  rec ${i.toString().padStart(2)} @0x${p.toString(16)} (${x.toString().padStart(4)},${y.toString().padStart(4)}): ${hex}`);
  }

  // Step 2: Look backwards from anchor to find header / count
  console.log(`\nBytes BEFORE anchor (search for table header / count):`);
  const preStart = anchor - 64;
  const preSlice = buf.slice(preStart, anchor);
  console.log(`  0x${preStart.toString(16)}..0x${anchor.toString(16)}: ${preSlice.toString("hex").match(/.{2}/g).join(" ")}`);
  // Check if there's a u32 count right before
  for (let off = 16; off > 0; off -= 4) {
    const v = buf.readUInt32LE(anchor - off);
    if (v > 0 && v < 100000) console.log(`    u32@-${off}: ${v}`);
  }

  // Step 3: Walk records by stride 40 until we hit something that doesn't
  // look like (x,y) for a tile coord. Coords are roughly 0..1024 each.
  console.log(`\nWalking records by 40-byte stride from anchor...`);
  let recs = [];
  let p = anchor;
  while (p + 40 <= buf.length) {
    const x = buf.readUInt32LE(p);
    const y = buf.readUInt32LE(p + 4);
    if (x >= 0 && x < 2048 && y >= 0 && y < 2048) {
      recs.push({ idx: recs.length, off: p, x, y, body: buf.slice(p, p + 40) });
      p += 40;
    } else break;
  }
  console.log(`  ${recs.length} contiguous (x,y)-looking records by stride 40`);

  // Print last 5 records
  console.log(`  Last 5 records:`);
  for (const r of recs.slice(-5)) {
    const hex = r.body.toString("hex").match(/.{2}/g).join(" ");
    console.log(`    rec ${r.idx} @0x${r.off.toString(16)} (${r.x},${r.y}): ${hex}`);
  }

  // Show byte pattern — what's at offsets 8..40 within each record?
  // For the first 22 (known starting watchtowers) vs subsequent records.
  console.log(`\n--- Byte +8..+39 unique value tally across all records ---`);
  for (let off = 8; off < 40; off++) {
    const vals = new Set();
    for (const r of recs) vals.add(r.body[off]);
    if (vals.size > 1 && vals.size < 20) {
      const arr = [...vals].sort((a, b) => a - b).map(v => `0x${v.toString(16)}`);
      console.log(`  +${off.toString().padStart(2)}: ${vals.size} distinct = ${arr.join(",")}`);
    }
  }

  // Check: do any of the records' u32@0,@4 NOT look like watchtower coords?
  // (i.e., it might be a different entity type in the same table)
  // Show v at byte +28 distribution (often a faction id or type code)
  console.log(`\n--- Byte +28 (potential faction/type) distribution ---`);
  {
    const tally = {};
    for (const r of recs) tally[r.body[28]] = (tally[r.body[28]] || 0) + 1;
    for (const [v, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      console.log(`  +28=0x${(+v).toString(16)}: ${n}`);
    }
  }
}
