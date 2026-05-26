// dig-postgrid-byte20.js — examine column +0x20 of each post-grid record
// to characterize the unique ones.
"use strict";
const fs = require("fs");

const SAVES = [
  ["t900-end",       "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 900 End.sav"],
  ["t960-start",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

function findPostGrid(buf) {
  // Save varies — start scanning right after the implicit settlement-0 detail.
  // SCAN_START should be at 0xf84632 (end of tile-grid). The settlement-0 detail
  // sits there. Try a broader scan.
  const SCAN_START = 0xf84632;
  const size = buf.length;
  const SCAN_END = Math.min(size, SCAN_START + 0x200000);
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

  // Walk records, look at byte +0x20 and +0x21 distribution
  const tally20 = {};
  const tally21 = {};
  let p = first, count = 0;
  const baseRec = buf.slice(first, first + 267);
  let unique = 0;
  let pairValueCounts = {};

  while (p + 267 <= buf.length && buf.readUInt32LE(p) === magic) {
    count++;
    const v20 = buf[p + 0x20];
    const v21 = buf[p + 0x21];
    tally20[v20] = (tally20[v20] || 0) + 1;
    tally21[v21] = (tally21[v21] || 0) + 1;
    const pair = `${v20.toString(16)}_${v21.toString(16)}`;
    pairValueCounts[pair] = (pairValueCounts[pair] || 0) + 1;
    if (!buf.slice(p, p + 267).equals(baseRec)) unique++;
    let nx = -1;
    for (let k = 1; k <= 6; k++) {
      const cand = p + k * 267;
      if (cand + 4 > buf.length) break;
      if (buf.readUInt32LE(cand) === magic) { nx = cand; break; }
    }
    if (nx < 0) { p += 267; break; }
    p = nx;
  }
  console.log(`  count=${count}, unique=${unique}`);
  // Show byte +0x20 distribution (top 10)
  const top20 = Object.entries(tally20).sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log(`  +0x20 distribution: ${top20.map(([v,n])=>`0x${(+v).toString(16)}=${n}`).join(", ")}`);
  // Non-template count
  const nonTpl = Object.entries(tally20).filter(([v,n])=>parseInt(v) !== 0xc8).reduce((a,[v,n])=>a+n,0);
  console.log(`  non-c8 records: ${nonTpl} (target watchtowers=363)`);
  // Show byte pair +0x20/+0x21 distribution
  const topPair = Object.entries(pairValueCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log(`  +0x20/+0x21 pair: ${topPair.map(([k,n])=>`${k}=${n}`).join(", ")}`);

  // Dump first 5 unique records (skip template)
  console.log(`  First 5 unique records:`);
  let p2 = first, shown = 0, recIdx = 0;
  while (p2 + 267 <= buf.length && buf.readUInt32LE(p2) === magic && shown < 5) {
    if (!buf.slice(p2, p2 + 267).equals(baseRec)) {
      const slice = buf.slice(p2, p2 + 64);
      console.log(`    rec ${recIdx} @ 0x${p2.toString(16)}: ${slice.toString("hex").match(/.{2}/g).join(" ")}`);
      shown++;
    }
    recIdx++;
    let nx = -1;
    for (let k = 1; k <= 6; k++) {
      const cand = p2 + k * 267;
      if (cand + 4 > buf.length) break;
      if (buf.readUInt32LE(cand) === magic) { nx = cand; break; }
    }
    if (nx < 0) { p2 += 267; break; }
    p2 = nx;
  }
}
