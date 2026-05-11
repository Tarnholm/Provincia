// dig-diplo1.js — search for diplomacy relation matrix
// Strategy: find regions of uniform small-int data (potential matrix) that differ between pre-war and post-war saves.
const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const buf1 = fs.readFileSync(path.join(SAVES, "save_1turnstart.sav"));
const buf2 = fs.readFileSync(path.join(SAVES, "save_1.1.sav"));

function find(buf, s) { return buf.indexOf(Buffer.from(s, "utf8")); }

// Anchor at captain_card_sparta (Sparta-faction-record marker)
const o1 = find(buf1, "captain_card_sparta.tga");
const o2 = find(buf2, "captain_card_sparta.tga");
console.log("Anchors: 1turnstart=0x" + o1.toString(16) + " 1.1=0x" + o2.toString(16));

// Search for a region where:
//   - bytes are u32 LE values, mostly in 0..255 range (small enum like)
//   - region is >= 80 consecutive 4-byte entries (= 320 bytes; sufficient for 80-faction matrix row)
// Scan whole file 1turnstart for such regions

function scanSmallIntRegions(buf, minRun = 40, maxVal = 5) {
  // Walk u32 stride. Find runs of consecutive u32s where value <= maxVal.
  const regions = [];
  let runStart = -1, runLen = 0;
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    const v = buf.readUInt32LE(i);
    if (v <= maxVal) {
      if (runStart < 0) runStart = i;
      runLen++;
    } else {
      if (runLen >= minRun) regions.push({ start: runStart, end: i, len: runLen });
      runStart = -1; runLen = 0;
    }
  }
  if (runLen >= minRun) regions.push({ start: runStart, end: buf.length, len: runLen });
  return regions;
}

const regions = scanSmallIntRegions(buf1, 40, 5);
console.log("regions of small-u32 runs (>=40 entries, val<=5):", regions.length);
console.log("Top 20 largest:");
regions.sort((a,b)=>b.len-a.len).slice(0,20).forEach(r=>{
  console.log("  start=0x"+r.start.toString(16)+" len="+r.len+" entries ("+(r.len*4)+" bytes)");
});

// Now look for diplomacy specifically: regions where some bytes change between buf1 and buf2.
// Try value <= 10 to allow more states.
const regions2 = scanSmallIntRegions(buf1, 40, 10);
console.log("\nregions with val<=10 in buf1 (>=40 entries): " + regions2.length);

// For each region, check if buf2 has differing bytes at the same FILE OFFSET (no alignment)
console.log("Checking buf1 small regions for diffs in buf2 at same file offset:");
let hadDiff = 0;
for (const r of regions2.sort((a,b)=>b.len-a.len).slice(0,30)) {
  let diff = 0;
  for (let i = r.start; i < r.end && i < buf2.length; i++) {
    if (buf1[i] !== buf2[i]) diff++;
  }
  if (diff > 0) {
    hadDiff++;
    console.log("  region 0x" + r.start.toString(16) + " len=" + r.len + " entries; diff bytes=" + diff);
  }
}
console.log("regions w/ diffs: " + hadDiff);
