// Raw byte diff between diplo_before and diplo_after. Filter out
// hash-only changes (4-byte clusters where bytes look like 32-bit random
// values) and surface the real diplomatic-state changes.
const fs = require("fs");
const PRE = fs.readFileSync("C:/Users/vtarn/Downloads/save_diplo_before.sav..sav");
const POST = fs.readFileSync("C:/Users/vtarn/Downloads/save_diplo_after.sav..sav");

console.log(`PRE: ${PRE.length}, POST: ${POST.length}, delta ${POST.length - PRE.length}`);

const minLen = Math.min(PRE.length, POST.length);

// Find all change clusters with gap > 16
const clusters = [];
let cur = null;
for (let i = 0; i < minLen; i++) {
  if (PRE[i] !== POST[i]) {
    if (!cur) cur = { start: i, end: i + 1 };
    else cur.end = i + 1;
  } else if (cur && i - cur.end > 16) {
    clusters.push(cur);
    cur = null;
  }
}
if (cur) clusters.push(cur);

console.log(`${clusters.length} change clusters`);
console.log(`Total changed bytes: ${clusters.reduce((s, c) => s + (c.end - c.start), 0)}`);

// Distribution by cluster size
const bySize = new Map();
for (const c of clusters) {
  const sz = c.end - c.start;
  bySize.set(sz, (bySize.get(sz) || 0) + 1);
}
console.log("\nCluster sizes:");
for (const [sz, n] of Array.from(bySize.entries()).sort((a, b) => a[0] - b[0]).slice(0, 15)) {
  console.log(`  ${sz}b: ${n} clusters`);
}

// Filter to clusters of "interesting" sizes (not 4-byte hash updates)
// and clusters that have at least one zero/small-int byte pattern
const interesting = clusters.filter(c => {
  const sz = c.end - c.start;
  // 4-byte clusters are usually just hash updates
  if (sz === 4) return false;
  return true;
});
console.log(`\nInteresting (non-4b) clusters: ${interesting.length}`);

// Show first 30 interesting clusters
for (const r of interesting.slice(0, 30)) {
  const sz = r.end - r.start;
  const ctxStart = Math.max(0, r.start - 4);
  const ctxLen = Math.min(48, sz + 12);
  const preHex = Array.from(PRE.slice(ctxStart, ctxStart + ctxLen)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const postHex = Array.from(POST.slice(ctxStart, ctxStart + ctxLen)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`\n  0x${r.start.toString(16).padStart(7, "0")}-0x${r.end.toString(16)} (${sz}b)`);
  console.log(`    pre:  ${preHex}`);
  console.log(`    post: ${postHex}`);
}
