// dig-diplo-7.js — session 108 step 7
//
// Diff-based hunting. Two pairs:
//   (a) save_10_fresh (T0, no diplo activity) vs save_1.2 (mid-campaign,
//       many diplo events). EVERY diplomatic change shows up here.
//   (b) ror_t1e (end of turn 1) vs save_10_fresh (T0). What changes in 1 turn?
//
// The diplomatic state must be in a region that:
//   * Differs between T0 and mid-campaign
//   * Is bounded in size (a few KB at most for 23×23 or 23×22 cells)
//   * Has values from a small enum (war / peace / alliance / neutral)
//
// Use this to narrow down where diplomacy lives.
//
// Usage: node dig-diplo-7.js
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "fixtures", "feral");
const fresh = fs.readFileSync(path.join(root, "save_10_fresh.sav"));
const s12 = fs.readFileSync(path.join(root, "save_1.2.sav"));
const rt1 = fs.readFileSync(path.join(root, "ror_t1e.sav"));
const rt5 = fs.readFileSync(path.join(root, "ror_t5.sav"));
const rt11s = fs.readFileSync(path.join(root, "ror_t11s.sav"));
const rt11e = fs.readFileSync(path.join(root, "ror_t11e.sav"));

console.log(`fresh: ${fresh.length}  s12: ${s12.length}  rt1: ${rt1.length}  rt5: ${rt5.length}  rt11s: ${rt11s.length}  rt11e: ${rt11e.length}`);

// Direct byte diff (only works for same-size files).
// Use ror_t11s vs ror_t11e — same size? Probably not, but let's try.
function diffBytes(a, b) {
  const minLen = Math.min(a.length, b.length);
  const diffPositions = [];
  let i = 0;
  while (i < minLen) {
    if (a[i] !== b[i]) {
      // find run end
      let j = i;
      while (j < minLen && a[j] !== b[j]) j++;
      diffPositions.push({ start: i, len: j - i });
      i = j;
    } else {
      i++;
    }
  }
  return diffPositions;
}

console.log(`\n=== rt11s vs rt11e diff (same turn 11, start vs end) ===`);
console.log(`sizes: ${rt11s.length} vs ${rt11e.length} (delta ${rt11s.length - rt11e.length})`);
const d11 = diffBytes(rt11s, rt11e);
console.log(`Diff regions (head): ${d11.length}`);
// Total bytes diff
let totalDiff = d11.reduce((s, d) => s + d.len, 0);
console.log(`Total bytes diff: ${totalDiff}`);
console.log(`First 20 diff regions:`);
d11.slice(0, 20).forEach((d) => console.log(`  pos=0x${d.start.toString(16)} len=${d.len}`));

// Group diff regions into "clusters" within 64 bytes
function clusterDiffs(diffs, gap) {
  const clusters = [];
  let cur = null;
  for (const d of diffs) {
    if (!cur) {
      cur = { start: d.start, end: d.start + d.len, regions: 1 };
    } else if (d.start - cur.end <= gap) {
      cur.end = d.start + d.len;
      cur.regions += 1;
    } else {
      clusters.push(cur);
      cur = { start: d.start, end: d.start + d.len, regions: 1 };
    }
  }
  if (cur) clusters.push(cur);
  return clusters;
}

const clusters = clusterDiffs(d11, 256);
console.log(`\nClusters (gap=256): ${clusters.length}`);
console.log("Top 20 clusters by size:");
clusters.sort((a, b) => (b.end - b.start) - (a.end - a.start));
clusters.slice(0, 20).forEach((c) => {
  console.log(`  0x${c.start.toString(16)} .. 0x${c.end.toString(16)} (${c.end - c.start} B, ${c.regions} regions)`);
});

// Now also see athens t22s vs t22e (single tick within turn) and save_mp_before/after (1-tile move).
const a22s = fs.readFileSync(path.join(root, "athens_t22s.sav"));
const a22e = fs.readFileSync(path.join(root, "athens_t22e.sav"));
const mpB = fs.readFileSync(path.join(root, "save_mp_before.sav"));
const mpA = fs.readFileSync(path.join(root, "save_mp_after.sav"));

console.log(`\n=== athens_t22s vs athens_t22e diff (within turn 22) ===`);
const dAt = diffBytes(a22s, a22e);
const cAt = clusterDiffs(dAt, 256);
console.log(`diffs=${dAt.length}, clusters=${cAt.length}, totalDiffBytes=${dAt.reduce((s,d)=>s+d.len,0)}`);
cAt.sort((a, b) => (b.end - b.start) - (a.end - a.start));
console.log("Top 10 clusters:");
cAt.slice(0, 10).forEach((c) => {
  console.log(`  0x${c.start.toString(16)} .. 0x${c.end.toString(16)} (${c.end - c.start} B)`);
});

console.log(`\n=== save_mp_before vs save_mp_after (1-tile move) ===`);
const dMp = diffBytes(mpB, mpA);
const cMp = clusterDiffs(dMp, 256);
console.log(`diffs=${dMp.length}, clusters=${cMp.length}, totalDiffBytes=${dMp.reduce((s,d)=>s+d.len,0)}`);
console.log("All clusters >100 B:");
cMp.filter((c) => c.end - c.start > 100).forEach((c) => {
  console.log(`  0x${c.start.toString(16)} .. 0x${c.end.toString(16)} (${c.end - c.start} B)`);
});
