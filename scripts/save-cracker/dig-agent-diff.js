// dig-agent-diff.js
// Byte-diff between baseline Turn 1 and the "move spy" / "move diplomat" saves.
// The only gameplay change is one agent moving, so changed byte runs localise
// the agent's live position/state record. Cluster changes into runs and dump
// context for each.
const fs = require("fs");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";

function load(n) { return fs.readFileSync(SAVE_DIR + n); }

function diff(aName, bName) {
  const a = load(aName), b = load(bName);
  console.log(`\n#################################################`);
  console.log(`# DIFF  base="${aName}" (${a.length})`);
  console.log(`#       new ="${bName}" (${b.length})`);
  const n = Math.min(a.length, b.length);
  // Collect changed byte indices, cluster into runs (gap <= 16 merges).
  const runs = [];
  let i = 0;
  while (i < n) {
    if (a[i] !== b[i]) {
      let start = i, end = i;
      let gap = 0;
      let j = i + 1;
      while (j < n && gap <= 16) {
        if (a[j] !== b[j]) { end = j; gap = 0; }
        else gap++;
        j++;
      }
      runs.push({ start, end });
      i = end + 1;
    } else i++;
  }
  if (a.length !== b.length) {
    console.log(`# length differs by ${b.length - a.length} (insertion)`);
  }
  console.log(`# ${runs.length} changed runs`);
  for (const r of runs) {
    const len = r.end - r.start + 1;
    // Dump context window
    const ctxStart = Math.max(0, r.start - 16);
    const ctxEnd = Math.min(n, r.end + 16);
    const ah = [], bh = [], asc = [];
    for (let k = ctxStart; k < ctxEnd; k++) {
      const mark = a[k] !== b[k] ? "*" : " ";
      ah.push(a[k].toString(16).padStart(2, "0") + mark);
      bh.push(b[k].toString(16).padStart(2, "0") + mark);
      asc.push(a[k] >= 0x20 && a[k] <= 0x7e ? String.fromCharCode(a[k]) : ".");
    }
    console.log(`\n  RUN @0x${r.start.toString(16)}..0x${r.end.toString(16)} len=${len}`);
    console.log(`    asc: ${asc.join("")}`);
    console.log(`    A:   ${ah.join("")}`);
    console.log(`    B:   ${bh.join("")}`);
  }
}

diff("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1 move spy.sav");
diff("save_17-05-2026   Spain   Turn 1.sav", "save_17-05-2026   Spain   Turn 1move diplomat and army.sav");
