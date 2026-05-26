// Raw byte diff between Spain T4 Start (peace) and Spain T4 War.
// Find clusters of changed bytes — those identify the diplomacy storage.
const fs = require("fs");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const PRE = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 Start.sav`);
const POST = fs.readFileSync(`${BASE}\\save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav`);

console.log(`PRE: ${PRE.length}, POST: ${POST.length}, delta ${POST.length - PRE.length}`);

// Find positions where bytes differ. Since POST is bigger, alignment shifts
// after first divergence. Use sliding-window approach to identify change clusters.
// Simple: byte-by-byte while sizes match, log clusters.
const minLen = Math.min(PRE.length, POST.length);

const changedRegions = []; // [{ start, end, preBytes, postBytes }]
let cur = null;
for (let i = 0; i < minLen; i++) {
  if (PRE[i] !== POST[i]) {
    if (!cur) cur = { start: i, end: i + 1 };
    else cur.end = i + 1;
  } else {
    if (cur) {
      if (i - cur.end > 32) {  // gap > 32 bytes ends a region
        changedRegions.push(cur);
        cur = null;
      }
    }
  }
}
if (cur) changedRegions.push(cur);

console.log(`\n${changedRegions.length} change clusters in matched region (first ${minLen} bytes)`);
// Show first 20 clusters
for (const r of changedRegions.slice(0, 25)) {
  const sz = r.end - r.start;
  const preHex = Array.from(PRE.slice(r.start, Math.min(r.end, r.start + 16))).map(b => b.toString(16).padStart(2, "0")).join(" ");
  const postHex = Array.from(POST.slice(r.start, Math.min(r.end, r.start + 16))).map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`  0x${r.start.toString(16).padStart(7,'0')}-0x${r.end.toString(16)} (${sz}b)`);
  console.log(`    pre:  ${preHex}`);
  console.log(`    post: ${postHex}`);
}

// Diplo at 0xcff0 in vanilla per memory — what's there in both?
console.log("\n=== bytes around 0xcff0 (vanilla diplo location per memory) ===");
console.log("PRE  0xcff0..0xd010:");
let hex = "";
for (let i = 0; i < 32; i++) hex += PRE[0xcff0 + i].toString(16).padStart(2, "0") + " ";
console.log("  " + hex);
console.log("POST 0xcff0..0xd010:");
hex = "";
for (let i = 0; i < 32; i++) hex += POST[0xcff0 + i].toString(16).padStart(2, "0") + " ";
console.log("  " + hex);
