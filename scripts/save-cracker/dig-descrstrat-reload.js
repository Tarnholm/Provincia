// Set 5 — descr_strat reload experiment.
// User edited descr_strat to put romans_julii at war with carthage,
// reloaded the PRE save. Game showed peace (= save state was authoritative,
// descr_strat changes ignored at load). After saving again as POST, do PRE
// and POST differ?
// - If identical → conclusive proof descr_strat isn't re-read on load
// - If only timer / RNG bytes differ → same conclusion (cosmetic noise)
// - If diplomatic relations bytes differ → game DID partially re-read
const fs = require("fs");

const PRE = fs.readFileSync("C:/Users/vtarn/Downloads/save_descrstrat_pre.sav..sav");
const POST = fs.readFileSync("C:/Users/vtarn/Downloads/save_descrstrat_post-sav..sav");

console.log(`PRE: ${PRE.length} bytes  POST: ${POST.length} bytes  delta ${POST.length - PRE.length}`);

const minLen = Math.min(PRE.length, POST.length);

// Cluster differences (gap > 32 bytes ends a cluster)
const clusters = [];
let cur = null;
for (let i = 0; i < minLen; i++) {
  if (PRE[i] !== POST[i]) {
    if (!cur) cur = { start: i, end: i + 1 };
    else cur.end = i + 1;
  } else if (cur && i - cur.end > 32) {
    clusters.push(cur);
    cur = null;
  }
}
if (cur) clusters.push(cur);

console.log(`\n${clusters.length} change clusters total`);

// Histogram by cluster size
const sizes = clusters.map(c => c.end - c.start);
const bigClusters = clusters.filter(c => (c.end - c.start) >= 16);
console.log(`Clusters ≥ 16 bytes: ${bigClusters.length}`);
console.log(`Total changed bytes: ${sizes.reduce((s, x) => s + x, 0)}`);

// Show first 20 large clusters
console.log("\n=== Large clusters (≥16b) ===");
for (const r of bigClusters.slice(0, 20)) {
  const sz = r.end - r.start;
  const ctxStart = Math.max(0, r.start - 4);
  const preHex = Array.from(PRE.slice(ctxStart, ctxStart + Math.min(32, sz + 8))).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const postHex = Array.from(POST.slice(ctxStart, ctxStart + Math.min(32, sz + 8))).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  0x${r.start.toString(16).padStart(7, "0")}-0x${r.end.toString(16)} (${sz}b)`);
  console.log(`    pre:  ${preHex}`);
  console.log(`    post: ${postHex}`);
}
