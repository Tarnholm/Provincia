// Within-turn diff: Spain Turn 1 vs Turn 1 + diplomat and army moved.
// Builds on spy-move finding to identify army/character positions.
const fs = require("fs");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const PRE = fs.readFileSync(`${BASE}\\save_17-05-2026   Spain   Turn 1.sav`);
const POST = fs.readFileSync(`${BASE}\\save_17-05-2026   Spain   Turn 1move diplomat and army.sav`);

console.log(`PRE: ${PRE.length}, POST: ${POST.length}, delta ${POST.length - PRE.length}`);

const minLen = Math.min(PRE.length, POST.length);
const regions = [];
let cur = null;
for (let i = 0; i < minLen; i++) {
  if (PRE[i] !== POST[i]) {
    if (!cur) cur = { start: i, end: i + 1 };
    else cur.end = i + 1;
  } else {
    if (cur) {
      if (i - cur.end > 16) {
        regions.push(cur);
        cur = null;
      }
    }
  }
}
if (cur) regions.push(cur);

console.log(`\n${regions.length} change clusters (gap > 16 bytes)`);

// Filter out FoW (single byte changes from 0xff to 0x02/0x03 in long ff runs)
const isFow = (r) => {
  if (r.end - r.start > 4) return false;
  for (let i = r.start; i < r.end; i++) {
    if (PRE[i] !== 0xff) return false;
    if (POST[i] !== 0x02 && POST[i] !== 0x03) return false;
  }
  return true;
};
const nonFow = regions.filter(r => !isFow(r));
console.log(`${nonFow.length} non-FoW clusters`);

console.log("\n=== Non-FoW clusters ===");
for (const r of nonFow) {
  const sz = r.end - r.start;
  // Show with context
  const ctxStart = Math.max(0, r.start - 8);
  const ctxLen = Math.min(48, sz + 16);
  const preHex = Array.from(PRE.slice(ctxStart, ctxStart + ctxLen)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const postHex = Array.from(POST.slice(ctxStart, ctxStart + ctxLen)).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`\n0x${r.start.toString(16).padStart(7,'0')}-0x${r.end.toString(16)} (${sz}b) ctx@0x${ctxStart.toString(16)}:`);
  console.log(`  pre:  ${preHex}`);
  console.log(`  post: ${postHex}`);
  // If small, try interpreting as u32 coords
  if (sz <= 8) {
    const preU0 = PRE.readUInt32LE(r.start - (r.start % 4));
    const postU0 = POST.readUInt32LE(r.start - (r.start % 4));
    console.log(`  u32 at aligned offset 0x${(r.start - r.start % 4).toString(16)}: ${preU0} → ${postU0}`);
  }
}
