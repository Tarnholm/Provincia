// dig-alliance-deep7.js
// Different approach: look at the BIG cluster [0x84f2f..0xa8bf7] (146KB) and
// SAMPLE its structure. If it's a sequence of 267-byte-like cells (matrix overlap?),
// the alliance state lives elsewhere. If it's faction records, examine entry-by-entry.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

// Look at start of big cluster
const start = 0x84f2f;
const end = 0xa8bf7;
console.log(`Cluster [${start.toString(16)}..${end.toString(16)}] len=${end - start + 1}`);

// Sample several windows in A and B
for (let off = start; off < end && off < start + 1000; off += 64) {
  const aHex = A.slice(off, off + 64).toString("hex");
  const bHex = B.slice(off, off + 64).toString("hex");
  const sameStrs = aHex === bHex ? "  SAME" : "  DIFF";
  console.log(`0x${off.toString(16)}: ${sameStrs}`);
  console.log(`  A: ${aHex}`);
  console.log(`  B: ${bHex}`);
}

// Find the 32-byte stride? Look for the first "non-diff" run in the cluster
console.log("\n=== Walk from cluster start. Find longest matching run after a diff ===");
let pos = start;
while (pos < end) {
  // Find next match-or-diff transition
  if (A[pos] === B[pos]) {
    let mLen = 0;
    while (pos + mLen < end && A[pos + mLen] === B[pos + mLen]) mLen++;
    if (mLen >= 8) console.log(`0x${pos.toString(16)}: MATCH for ${mLen} bytes`);
    pos += mLen || 1;
  } else {
    let dLen = 0;
    while (pos + dLen < end && A[pos + dLen] !== B[pos + dLen]) dLen++;
    if (dLen >= 8) console.log(`0x${pos.toString(16)}: DIFF for ${dLen} bytes`);
    pos += dLen || 1;
  }
}
