// dig-buildchain7.js — Find the insertion point properly.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

const skew = constrBuf.length - startBuf.length;
console.log(`skew=${skew}`);

// Slide approach: at each potential insertion point ins, check whether the file resyncs after.
// Use a strong match score: 100 byte window.
function score(ins) {
  let s = 0;
  for (let k = 0; k < 200; k++) {
    if (ins + skew + k >= constrBuf.length) break;
    if (constrBuf[ins + skew + k] === startBuf[ins + k]) s++;
  }
  return s;
}

// Try each position from 0 to end
console.log("Searching for insertion point:");
let bestIns = -1, bestScore = -1;
for (let ins = 0; ins < startBuf.length - 200; ins += 100) {
  const s = score(ins);
  if (s > bestScore) { bestScore = s; bestIns = ins; }
}
// Refine
for (let ins = Math.max(0, bestIns - 200); ins < bestIns + 200; ins++) {
  const s = score(ins);
  if (s > bestScore) { bestScore = s; bestIns = ins; }
}
console.log(`Best ins: 0x${bestIns.toString(16)} score=${bestScore}/200`);

// Find the first position where score(ins) >= 195 (near-perfect match)
for (let ins = 0; ins < startBuf.length - 200; ins++) {
  const s = score(ins);
  if (s >= 198) {
    console.log(`First ins with score>=198: 0x${ins.toString(16)}`);
    // Dump inserted bytes
    const hex = [], asc = [];
    for (let k = 0; k < skew && k < 100; k++) {
      const b = constrBuf[ins + k];
      hex.push(b.toString(16).padStart(2, "0"));
      asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
    }
    console.log(`Inserted bytes [first 100/${skew}]:`);
    for (let i = 0; i < Math.min(100, skew); i += 16) {
      console.log(`  ${hex.slice(i, i+16).join(" ")}  | ${asc.slice(i, i+16).join("")}`);
    }
    break;
  }
}

// Now alignment-based diff: at each position ins, compare startBuf[ins] vs constrBuf[ins] AND
// startBuf[ins] vs constrBuf[ins + skew]
console.log("\nFinding insertion point with bidirectional check:");
// Score each candidate: what's the max k such that startBuf[ins+j] === constrBuf[ins+j] for j < ins-k
// AND startBuf[ins+j] === constrBuf[ins+j+skew] for j >= ins
let bestIns2 = -1;
for (let ins = 0; ins < startBuf.length; ins += 1000) {
  // Count matches at start (before ins)
  let pre = 0;
  for (let k = 0; k < 200 && ins - k - 1 >= 0; k++) {
    if (startBuf[ins - k - 1] === constrBuf[ins - k - 1]) pre++;
    else break;
  }
  let post = 0;
  for (let k = 0; k < 200; k++) {
    if (ins + skew + k >= constrBuf.length || ins + k >= startBuf.length) break;
    if (startBuf[ins + k] === constrBuf[ins + skew + k]) post++;
    else break;
  }
  if (pre > 50 && post > 50) {
    if (bestIns2 < 0) bestIns2 = ins;
    console.log(`  ins=0x${ins.toString(16)} pre=${pre} post=${post}`);
  }
}
