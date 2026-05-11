// Cross-correlate save_2.0 (high), save_2.1 (very_high), save_2.2 (low) to
// find the complete tax enum mapping. Same file size → direct byte
// comparison works. The tax bytes are the ones with THREE DISTINCT values
// across the three saves (each tax level has a unique enum byte).
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const baseline = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const v20 = fs.readFileSync(path.join(SAVE_DIR, "save_2.0.sav")); // high
const v21 = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav")); // very_high
const v22 = fs.readFileSync(path.join(SAVE_DIR, "save_2.2.sav")); // low

console.log(`baseline: ${baseline.length}  v2.0: ${v20.length}  v2.1: ${v21.length}  v2.2: ${v22.length}`);
console.log(`(saves 2.0/2.1/2.2 all same size → direct comparison works)\n`);

const cap = Math.min(v20.length, v21.length, v22.length);

// Step 1: find every byte where 2.0, 2.1, 2.2 all differ from each other
const triDiff = [];
for (let i = 0; i < cap; i++) {
  if (v20[i] !== v21[i] && v21[i] !== v22[i] && v20[i] !== v22[i]) {
    triDiff.push({ off: i, v20: v20[i], v21: v21[i], v22: v22[i] });
  }
}
console.log(`bytes with 3 distinct values across save_2.0/2.1/2.2: ${triDiff.length}`);

// Step 2: filter to small-enum-like values (all < 16)
const enumLike = triDiff.filter(c => c.v20 < 16 && c.v21 < 16 && c.v22 < 16);
console.log(`...with all 3 values < 16 (enum-like): ${enumLike.length}\n`);

// Group by transition pattern
const byPattern = {};
for (const c of enumLike) {
  const k = `${c.v20}|${c.v21}|${c.v22}`;
  if (!byPattern[k]) byPattern[k] = [];
  byPattern[k].push(c);
}
console.log(`unique tri-value patterns:`);
for (const [k, arr] of Object.entries(byPattern).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k}  (high|veryHigh|low):  ${arr.length} occurrences`);
}

// The most common pattern with all 3 distinct should be the tax field
const sortedPatterns = Object.entries(byPattern).sort((a, b) => b[1].length - a[1].length);
if (sortedPatterns.length > 0) {
  const [topPattern, topArr] = sortedPatterns[0];
  console.log(`\n*** Most likely tax enum: high=${topPattern.split("|")[0]}, very_high=${topPattern.split("|")[1]}, low=${topPattern.split("|")[2]} ***`);
  console.log(`   ${topArr.length} byte offsets carry this enum`);

  // Show first 30 offsets
  console.log(`\n[first 30 offsets]`);
  for (const c of topArr.slice(0, 30)) {
    // Also check baseline value at this offset (with shift adjustment)
    // baseline is shifted by ~166K; we need to find the matching offset
    // For now: report v2.0 offset and the values
    console.log(`  @0x${c.off.toString(16).padStart(8,"0")}  high=${c.v20}, very_high=${c.v21}, low=${c.v22}`);
  }

  // Check: are these clustered or spread?
  const offs = topArr.map(c => c.off).sort((a, b) => a - b);
  console.log(`\noffset range: 0x${offs[0].toString(16)} – 0x${offs[offs.length - 1].toString(16)}  (span ${(offs[offs.length - 1] - offs[0]).toLocaleString()} bytes)`);

  // Stride between consecutive
  const strides = [];
  for (let i = 1; i < offs.length; i++) strides.push(offs[i] - offs[i - 1]);
  if (strides.length > 0) {
    const sortedStrides = [...strides].sort((a, b) => a - b);
    console.log(`stride histogram (sorted): ${sortedStrides.slice(0, 20).join(", ")}${strides.length > 20 ? "..." : ""}`);
  }
}

// Cross-reference with the Saka save_3 finding (Sakon Taphai → high gave 0→3 at 6 offsets)
// In that case high=3. Let's see if the high value is the same in this Sparta study.
console.log(`\n[sanity check: in Saka save_3, high → byte=3. Does this Sparta study agree?]`);
const highValues = new Set(enumLike.map(c => c.v20));
console.log(`distinct values seen for HIGH across all enum-like positions: ${[...highValues].sort().join(", ")}`);
const veryHighValues = new Set(enumLike.map(c => c.v21));
console.log(`distinct values seen for VERY_HIGH: ${[...veryHighValues].sort().join(", ")}`);
const lowValues = new Set(enumLike.map(c => c.v22));
console.log(`distinct values seen for LOW: ${[...lowValues].sort().join(", ")}`);
