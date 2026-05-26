// dig-diploterms-12-warstructured.js
// The big churn region is a hash table of <idx><hash>01 20 <u16> records that
// reshuffles every action. Identify its extent, then look for STRUCTURED diffs
// OUTSIDE it that could be war state. Classify each diff run by whether it sits
// inside the churn region.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 Start.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"));

// Build diff runs (cohesive within 16-byte gaps)
const n = Math.min(a.length, b.length);
const runs = [];
let i = 0;
while (i < n) {
  if (a[i] !== b[i]) {
    let start = i, gap = 0, end = i, j = i;
    while (j < n && gap <= 16) { if (a[j] !== b[j]) { end = j; gap = 0; } else gap++; j++; }
    runs.push([start, end]); i = end + 1;
  } else i++;
}

// The churn region: find min/max offset of runs that match the hash pattern.
// Pattern: at run, bytes look like `XX 00 00 00 <4 hash> 01 20 YY 00`. Detect by
// checking that within the run, many positions have `01 20` two bytes apart.
function churnScore(buf, s, e) {
  let hits = 0, tries = 0;
  for (let o = s; o + 8 <= e; o += 4) {
    tries++;
    if (buf[o + 4] === 0x01 && buf[o + 5] === 0x20) hits++;
    else if (buf[o + 5] === 0x01 && buf[o + 6] === 0x20) hits++;
  }
  return tries ? hits / tries : 0;
}

let churnMin = Infinity, churnMax = -1, churnRuns = 0, otherRuns = [];
for (const [s, e] of runs) {
  const sc = churnScore(b, s, e);
  if (sc > 0.3) { churnRuns++; churnMin = Math.min(churnMin, s); churnMax = Math.max(churnMax, e); }
  else otherRuns.push([s, e, sc]);
}
console.log(`total runs=${runs.length} churnRuns=${churnRuns} churnExtent=0x${churnMin.toString(16)}..0x${churnMax.toString(16)}`);
console.log(`NON-churn runs: ${otherRuns.length}`);

function hexrow(buf, off, len) {
  const s = [];
  for (let i = 0; i < len; i++) { if (off+i>=0 && off+i<buf.length) s.push(buf[off+i].toString(16).padStart(2,"0")); }
  return s.join(" ");
}

// Print non-churn runs that are OUTSIDE the churn extent, with context
let shown = 0;
for (const [s, e, sc] of otherRuns) {
  if (s >= churnMin && e <= churnMax) continue; // skip stray small runs inside churn
  const len = e - s + 1;
  if (len > 400) { console.log(`\n  [BIG run @0x${s.toString(16)}..0x${e.toString(16)} len=${len} score=${sc.toFixed(2)} — skipping body]`); continue; }
  console.log(`\n  run @0x${s.toString(16)}..0x${e.toString(16)} len=${len} score=${sc.toFixed(2)}`);
  console.log(`    A: ${hexrow(a, s-6, Math.min(len+12, 70))}`);
  console.log(`    B: ${hexrow(b, s-6, Math.min(len+12, 70))}`);
  shown++;
  if (shown > 80) { console.log("... truncated"); break; }
}
