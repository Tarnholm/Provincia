// dig-alliance-deep8.js
// Sample the early-file cluster [0x52ed..0x1ec28] (104KB). Probably character records
// or scripted events. Detect cell stride.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

const start = 0x52ed;
const end = 0x1ec28;
console.log(`Cluster [${start.toString(16)}..${end.toString(16)}] len=${end - start + 1}`);

// Walk and report match/diff stride
let pos = start;
let strideHist = {};
let lastTransition = pos;
while (pos < end) {
  if (A[pos] === B[pos]) {
    let mLen = 0;
    while (pos + mLen < end && A[pos + mLen] === B[pos + mLen]) mLen++;
    strideHist["M" + mLen] = (strideHist["M" + mLen] || 0) + 1;
    pos += mLen || 1;
  } else {
    let dLen = 0;
    while (pos + dLen < end && A[pos + dLen] !== B[pos + dLen]) dLen++;
    strideHist["D" + dLen] = (strideHist["D" + dLen] || 0) + 1;
    pos += dLen || 1;
  }
}

const sorted = Object.entries(strideHist).sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log("Top stride patterns:");
for (const [k, v] of sorted) {
  console.log(`  ${k}: ${v}`);
}

// Print first 1024 bytes of cluster
console.log("\nFirst 256 bytes:");
console.log("A:", A.slice(start, start + 256).toString("hex"));
console.log("B:", B.slice(start, start + 256).toString("hex"));
