// dig-agent-infiltrate-diff.js
// Cleanest controlled pair: "Turn 3 End" (spy outside) vs "Turn 3 infiltrated
// city with spy" (spy embedded). These are autosaves around the same moment so
// AI churn should be minimal. The diff should reveal the "embedded in city" flag
// + the target settlement reference.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";
function load(n) { return fs.readFileSync(SAVE_DIR + n); }

const a = load("save_Autosave   Spain   Turn 3 End.sav");
const b = load("save_Autosave   Spain   Turn 3 inflitrated city with spy..sav");
console.log(`A=${a.length} B=${b.length} diff=${b.length - a.length}`);
const n = Math.min(a.length, b.length);

// Cluster changed runs (gap<=8 merges).
const runs = [];
let i = 0;
while (i < n) {
  if (a[i] !== b[i]) {
    let start = i, end = i, gap = 0, j = i + 1;
    while (j < n && gap <= 8) {
      if (a[j] !== b[j]) { end = j; gap = 0; } else gap++;
      j++;
    }
    runs.push({ start, end });
    i = end + 1;
  } else i++;
}
console.log(`${runs.length} changed runs`);
for (const r of runs) {
  const len = r.end - r.start + 1;
  const cs = Math.max(0, r.start - 24), ce = Math.min(n, r.end + 24);
  const ah = [], bh = [], asc = [];
  for (let k = cs; k < ce; k++) {
    const mk = a[k] !== b[k] ? "*" : " ";
    ah.push(a[k].toString(16).padStart(2, "0") + mk);
    bh.push(b[k].toString(16).padStart(2, "0") + mk);
    asc.push(a[k] >= 0x20 && a[k] <= 0x7e ? String.fromCharCode(a[k]) : ".");
  }
  console.log(`\nRUN @0x${r.start.toString(16)}..0x${r.end.toString(16)} len=${len}`);
  console.log(`  asc: ${asc.join("")}`);
  console.log(`  A:   ${ah.join("")}`);
  console.log(`  B:   ${bh.join("")}`);
}
