// dig-buildchain6.js — Find WHERE the 35-byte insertion happened in Pella's settlement.
// Compare both saves looking for the offset where a chunk of bytes appears in constr but not start.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

console.log(`start ${startBuf.length}, constr ${constrBuf.length}, delta ${constrBuf.length - startBuf.length}`);

// Find the FIRST position where the two files diverge in a way that can't be re-aligned within Pella's range.
// Look at the entire file from 0 onward for FIRST byte mismatch.
let firstDiff = -1;
for (let i = 0; i < Math.min(startBuf.length, constrBuf.length); i++) {
  if (startBuf[i] !== constrBuf[i]) { firstDiff = i; break; }
}
console.log(`First byte diff: 0x${firstDiff.toString(16)}`);

// From firstDiff, see how long until we resync (when start[i+0]==constr[i+35])
// (since constr is 35 bytes longer)
const skew = constrBuf.length - startBuf.length;
console.log(`Looking for resync point at start[i] === constr[i+${skew}]:`);
for (let i = firstDiff; i < firstDiff + 100000; i++) {
  let match = 0;
  for (let k = 0; k < 32; k++) {
    if (startBuf[i + k] === constrBuf[i + k + skew]) match++;
  }
  if (match >= 28) {
    console.log(`  Resync at i=0x${i.toString(16)} (offset from firstDiff = ${i - firstDiff})`);
    break;
  }
}

// More precise: find the EXACT insertion point. From firstDiff onward, find the position where constr
// has bytes that DON'T appear in start. Use a sliding window match.
// Look at constr[firstDiff..firstDiff+200] and check at each position whether the suffix matches start.
console.log(`\nFinding insertion point precisely:`);
const search = 5000;
for (let ins = firstDiff; ins < firstDiff + search; ins++) {
  // Hypothesis: constr inserts 'skew' bytes at position 'ins'. So for j > ins, constr[j] = start[j - skew]
  let ok = true;
  for (let k = 0; k < 100; k++) {
    if (ins + skew + k + 200 >= constrBuf.length) break;
    if (constrBuf[ins + skew + k] !== startBuf[ins + k]) { ok = false; break; }
  }
  if (ok) {
    console.log(`  Insertion point candidate: 0x${ins.toString(16)} (constr bytes 0x${ins.toString(16)}..0x${(ins+skew).toString(16)} = ${skew} new bytes)`);
    // Dump the inserted bytes
    const ins_hex = [];
    const asc = [];
    for (let k = 0; k < skew; k++) {
      const b = constrBuf[ins + k];
      ins_hex.push(b.toString(16).padStart(2, "0"));
      asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
    }
    console.log(`    Inserted: ${ins_hex.join(" ")}`);
    console.log(`    Inserted: ${asc.join("")}`);
    break;
  }
}

// Look at what comes BEFORE the insertion point: what's the context?
function dumpAt(buf, off, len, label) {
  console.log(`\n${label} @ 0x${off.toString(16)}:`);
  for (let i = 0; i < len; i += 16) {
    const row = [];
    const asc = [];
    for (let j = 0; j < 16; j++) {
      const b = buf[off + i + j];
      row.push(b.toString(16).padStart(2, "0"));
      asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
    }
    console.log(`  +${i.toString().padStart(3)}: ${row.join(" ")}  | ${asc.join("")}`);
  }
}
