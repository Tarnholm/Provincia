// dig-trade3.js — locate trade-route data by examining the SETTLEMENT_MECHANICS_STATS
// section in the save (HST v=5). Trade routes are likely a per-settlement
// adjacency list. Also try a same-size diff to localize big structural changes.
//
// Approach: rome5 vs rome6 (same size, within turn) and rome6 vs rome7
// (different size — turn boundary). Look for adjacent integer-pair clusters
// that satisfy "both u32s ∈ [1,1500]" and changes between saves.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const buf = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));

// Find candidate trade-route adjacency tables: long runs of u32 pairs both in
// region-id range [13..1306] (per session 5 region-id space).
// Look for streaks of >= 10 consecutive u32 in this range.
function scanRegionIdRuns(buf, minRun) {
  const out = [];
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    const v = buf.readUInt32LE(i);
    if (v >= 13 && v <= 1500) {
      if (runStart < 0) runStart = i;
      runLen++;
    } else {
      if (runLen >= minRun) out.push({ start: runStart, len: runLen, endIncl: i - 4 });
      runStart = -1;
      runLen = 0;
    }
  }
  if (runLen >= minRun) out.push({ start: runStart, len: runLen, endIncl: buf.length - 4 });
  return out;
}

const runs = scanRegionIdRuns(buf, 8);
console.log(`# u32-aligned runs of ${'>='}8 consecutive region-id-like values in rome6 (top 40 by length)`);
runs.sort((a, b) => b.len - a.len);
for (const r of runs.slice(0, 40)) {
  const sample = [];
  for (let i = 0; i < Math.min(r.len, 8); i++) sample.push(buf.readUInt32LE(r.start + i * 4));
  console.log(`  0x${r.start.toString(16).padStart(8, "0")}  len=${String(r.len).padStart(4)}  samples: ${sample.join(",")}`);
}

console.log(`\n# Total runs: ${runs.length}`);
console.log(`# Total slots: ${runs.reduce((s, r) => s + r.len, 0)}`);
