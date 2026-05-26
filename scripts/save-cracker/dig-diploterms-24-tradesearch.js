// dig-diploterms-24-tradesearch.js
// T1 -> T1move is SAME TURN with a trade made (uuid62 c5->c2). Find the SMALLEST
// set of structured changes besides the zone flip. The trade may create a treaty
// record holding partner=carthage(7) + (optional) payment. Diff the two saves but
// IGNORE the object-graph hash churn (regions where 4-byte values change wholesale
// with no semantic stride) by requiring the changed bytes to be small integers.
"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const a = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1move diplomat and army.sav"));
console.log(`sizes a=${a.length} b=${b.length} (delta=${b.length-a.length})`);

// Build diff runs
const n = Math.min(a.length, b.length);
const runs = [];
let i = 0;
while (i < n) {
  if (a[i] !== b[i]) { let s=i,gap=0,e=i,j=i; while(j<n&&gap<=12){if(a[j]!==b[j]){e=j;gap=0;}else gap++;j++;} runs.push([s,e]); i=e+1; } else i++;
}
console.log(`diff runs=${runs.length}`);

// Classify: a "hash churn" run has its changed u32s being large/random.
// A "semantic" run changes only SMALL values (<256) or known faction ids.
// We want runs where a value changes to/from 7 (carthage) or 18 (spain) or a
// plausible denarii amount, AND the run is small.
function hexrow(buf, off, len){const s=[];for(let k=0;k<len;k++){if(off+k>=0&&off+k<buf.length)s.push(buf[off+k].toString(16).padStart(2,"0"));}return s.join(" ");}

let interesting = 0;
for (const [s,e] of runs) {
  const len = e-s+1;
  if (len > 24) continue; // term records are small
  // Check changed bytes: are the differing u32s small?
  // Read the changed region as u32s where possible
  let smallChange = false;
  for (let o = s; o + 4 <= e+1; o++) {
    const va = a.readUInt32LE(o), vb = b.readUInt32LE(o);
    if (va !== vb && ((vb < 1000 && vb !== 0) || vb === 7 || vb === 18)) { smallChange = true; break; }
  }
  if (!smallChange) continue;
  interesting++;
  if (interesting > 40) { console.log("... truncated"); break; }
  console.log(`\n  run @0x${s.toString(16)} len=${len}`);
  console.log(`    A: ${hexrow(a, s-4, len+12)}`);
  console.log(`    B: ${hexrow(b, s-4, len+12)}`);
}
console.log(`\ninteresting small-value runs: ${interesting}`);
