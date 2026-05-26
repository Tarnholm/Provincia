// dig-diploterms-09-bytediff.js
// Find ALL changed byte-regions between two SAME-TURN saves (T4start vs T4war).
// War declaration must be recorded SOMEWHERE. Group contiguous diffs into runs
// and print context for each run so we can spot a diplomacy/war structure.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

function diffRuns(a, b, label) {
  const n = Math.min(a.length, b.length);
  const runs = [];
  let i = 0;
  while (i < n) {
    if (a[i] !== b[i]) {
      let start = i;
      // extend run; allow up to 8 matching bytes inside a run to keep it cohesive
      let gap = 0, end = i;
      let j = i;
      while (j < n && gap <= 8) {
        if (a[j] !== b[j]) { end = j; gap = 0; }
        else gap++;
        j++;
      }
      runs.push([start, end]);
      i = end + 1;
    } else i++;
  }
  console.log(`\n=== ${label}: sizes a=${a.length} b=${b.length} runs=${runs.length} ===`);
  return runs;
}

const a = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 Start.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"));
const runs = diffRuns(a, b, "T4start -> T4war (WAR)");

function hexrow(buf, off, len) {
  const s = [];
  for (let i = 0; i < len; i++) { if (off+i<buf.length) s.push(buf[off+i].toString(16).padStart(2,"0")); }
  return s.join(" ");
}

// Print every run (there should be relatively few in same-turn)
console.log(`Total runs: ${runs.length}`);
let printed = 0;
for (const [s, e] of runs) {
  const len = e - s + 1;
  // Skip very large runs (likely army/movement data appended); focus on small structured edits
  console.log(`\n  run @0x${s.toString(16)}..0x${e.toString(16)} len=${len}`);
  console.log(`    A: ${hexrow(a, s-4, Math.min(len+8, 64))}`);
  console.log(`    B: ${hexrow(b, s-4, Math.min(len+8, 64))}`);
  printed++;
  if (printed > 60) { console.log("  ... (truncated)"); break; }
}
