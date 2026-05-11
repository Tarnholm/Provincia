// dig-buildchain9.js — Find precise insertion point in Pella's record using sliding alignment.
// The 53 inserted bytes form the "construction queue entry". Identify what they encode.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

const PELLA_S = 0x10dae;  // start
const PELLA_END_S = 0x1157e;
const PELLA_END_C = 0x115b3;  // 53 bytes later
const insertSize = PELLA_END_C - PELLA_END_S;
console.log(`Insert size: ${insertSize}`);

// Find insertion point: byte position p such that:
//   startBuf[PELLA_S..p] === constrBuf[PELLA_S..p]
//   startBuf[p..PELLA_END_S] === constrBuf[p+insertSize..PELLA_END_C]
// Search for the position where post-insertion content resumes.
let bestIns = -1;
for (let p = PELLA_S; p < PELLA_END_S; p++) {
  // Check pre-equality: starts equal up to p
  let preOk = true;
  for (let i = PELLA_S; i < p; i++) {
    if (startBuf[i] !== constrBuf[i]) { preOk = false; break; }
  }
  if (!preOk) continue;
  // Check post-equality: startBuf[p..] === constrBuf[p+insertSize..]
  let postOk = true;
  for (let k = 0; k < 200 && p + k < PELLA_END_S && p + k + insertSize < PELLA_END_C; k++) {
    // But the runtime pointers (4 byte hash) differ — allow some misses
  }
  let matches = 0;
  for (let k = 0; k < 200 && p + k < PELLA_END_S && p + k + insertSize < constrBuf.length; k++) {
    if (startBuf[p + k] === constrBuf[p + k + insertSize]) matches++;
  }
  if (matches >= 180) {
    bestIns = p;
    console.log(`Insertion candidate: 0x${p.toString(16)} (+${p - PELLA_S} into Pella). Match score: ${matches}/200`);
    break;
  }
}

if (bestIns > 0) {
  // Show 53 bytes starting at bestIns in constrBuf
  console.log(`\nInserted bytes at 0x${bestIns.toString(16)}:`);
  const hex = [];
  const asc = [];
  for (let k = 0; k < insertSize; k++) {
    const b = constrBuf[bestIns + k];
    hex.push(b.toString(16).padStart(2, "0"));
    asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
  }
  for (let i = 0; i < insertSize; i += 16) {
    console.log(`  +${i.toString().padStart(3)}: ${hex.slice(i, i+16).join(" ").padEnd(48)} | ${asc.slice(i, i+16).join("")}`);
  }

  // Show context: 24 bytes before AND after the insertion in both saves
  console.log(`\nContext (start save, 24 before + 24 after pos 0x${bestIns.toString(16)}):`);
  for (let k = -24; k < 24; k++) {
    const sB = startBuf[bestIns + k] || 0;
    const sC = constrBuf[bestIns + k] || 0;
    const sCi = constrBuf[bestIns + k + insertSize] || 0;
    console.log(`  ${k>=0?'+':''}${k}: S=${sB.toString(16).padStart(2,"0")} C=${sC.toString(16).padStart(2,"0")} C+ins=${sCi.toString(16).padStart(2,"0")}`);
  }
}
