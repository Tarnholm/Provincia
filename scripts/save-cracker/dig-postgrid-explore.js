// dig-postgrid-explore.js — examine the post-grid 267-stride aux array
// Specifically: look at unique (non-template) records — could they be
// watchtowers/forts placed on tiles?
"use strict";
const fs = require("fs");

const SAVES = [
  ["t900-end",       "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 900 End.sav"],
  ["t960-start",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

// Reproduce the section-9c detector logic from cover.js to find array bounds
function findPostGrid(buf) {
  const SCAN_START = 0xf85f5c;
  const size = buf.length;
  const SCAN_END = Math.min(size, SCAN_START + 0x100000);
  const BODY_SIG = Buffer.from([0xc8, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00]);
  let p = SCAN_START;
  while (p + 16 <= SCAN_END) {
    const sigAt = buf.indexOf(BODY_SIG, p);
    if (sigAt < 0 || sigAt + 16 > SCAN_END) break;
    const cand = sigAt - 0x10;
    if (cand > SCAN_START && buf[cand - 1] === 0 && buf[cand] !== 0) {
      const nextSig = cand + 267 + 0x10;
      if (nextSig + 16 <= SCAN_END) {
        let match = true;
        for (let k = 0; k < 16; k++) if (buf[nextSig + k] !== BODY_SIG[k]) { match = false; break; }
        if (match) return cand;
      }
    }
    p = sigAt + 1;
  }
  return -1;
}

for (const [tag, path] of SAVES) {
  const buf = fs.readFileSync(path);
  console.log(`\n=== ${tag} ===`);
  const first = findPostGrid(buf);
  if (first < 0) { console.log("  post-grid array not found"); continue; }
  const magic = buf.readUInt32LE(first);
  // Walk by 267-byte stride while magic matches at +0
  let p = first, count = 0;
  while (p + 267 <= buf.length && buf.readUInt32LE(p) === magic) {
    count++;
    // Multi-stride lookahead
    let nx = -1;
    for (let k = 1; k <= 6; k++) {
      const cand = p + k * 267;
      if (cand + 4 > buf.length) break;
      if (buf.readUInt32LE(cand) === magic) { nx = cand; break; }
    }
    if (nx < 0) { p += 267; break; }
    p = nx;
  }
  console.log(`  array: 0x${first.toString(16)}..0x${p.toString(16)}, ${count} records, magic=0x${magic.toString(16)}`);

  // Compare each record to the template (record 0) and count unique
  const baseRec = buf.slice(first, first + 267);
  let unique = 0;
  // Also count records by their +0x44 sentinel = 0xffffffff
  // Look for some byte that might be the "type" identifier
  // Bytes that change between unique records are at certain offsets
  const colByteHistograms = {}; // col → tally
  let p2 = first;
  for (let i = 0; i < count; i++) {
    if (!buf.slice(p2, p2 + 267).equals(baseRec)) {
      unique++;
    }
    p2 += 267;
  }
  console.log(`  unique records (vs template): ${unique}`);

  // For each column, count how many records differ from the template at THAT column
  const diffByCol = new Array(267).fill(0);
  let p3 = first;
  for (let i = 0; i < count; i++) {
    for (let col = 0; col < 267; col++) {
      if (buf[p3 + col] !== baseRec[col]) diffByCol[col]++;
    }
    p3 += 267;
  }
  // Show top 10 columns with most differences
  const colRanked = diffByCol.map((d, i) => ({ col: i, d })).sort((a, b) => b.d - a.d).slice(0, 15);
  console.log(`  top columns with most differences (per-tile flags):`);
  for (const c of colRanked) {
    if (c.d === 0) break;
    console.log(`    +0x${c.col.toString(16).padStart(2,"0")}  diffs=${c.d}`);
  }
}
