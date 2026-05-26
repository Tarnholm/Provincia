// Find SOLDIER_PERSISTENT section more rigorously. Each 9-byte record:
//   byte +0: weapon_lvl × 4 ∈ {0,4,8,12}
//   bytes +1..+8: per-soldier data (varied)
// True section has:
//   - LONG run (thousands+ records)
//   - Byte +0 in valid set
//   - Bytes +1..+8 show variation (not all zero)
//   - At least 20% of records have weapon_lvl > 0 (otherwise it's pure zeros)
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const VALID = new Set([0, 4, 8, 12]);
const MIN_RUN = 500;

const runs = [];

for (let phase = 0; phase < 9; phase++) {
  let runStart = -1;
  let runLen = 0;
  let nonZeroFirst = 0;
  let entropyCheck = new Set();

  for (let p = phase; p + 9 < buf.length; p += 9) {
    const b = buf[p];
    if (VALID.has(b)) {
      if (runStart === -1) {
        runStart = p;
        nonZeroFirst = 0;
        entropyCheck = new Set();
      }
      runLen++;
      if (b > 0) nonZeroFirst++;
      // Track entropy of other bytes
      entropyCheck.add(buf[p + 1] * 256 + buf[p + 2]);
    } else {
      if (runLen >= MIN_RUN) {
        runs.push({ start: runStart, len: runLen, nonZeroPct: nonZeroFirst / runLen, entropy: entropyCheck.size, phase });
      }
      runStart = -1;
      runLen = 0;
    }
  }
}

console.log(`${runs.length} runs >= ${MIN_RUN} stride-9 records found`);
// Filter to runs with > 5% nonzero weapon levels and > 50 unique +1,+2 values
const candidates = runs.filter(r => r.nonZeroPct > 0.05 && r.entropy > 50);
console.log(`${candidates.length} candidates with entropy + nonzero weapon levels`);

candidates.sort((a, b) => b.len - a.len);
for (const c of candidates.slice(0, 10)) {
  console.log(`  phase=${c.phase}  start=0x${c.start.toString(16)}  len=${c.len.toLocaleString()}  nonZero=${(c.nonZeroPct*100).toFixed(1)}%  entropy=${c.entropy}`);
}

if (candidates.length > 0) {
  const best = candidates[0];
  console.log(`\nbest: start=0x${best.start.toString(16)}, ${best.len} records (${best.len * 9} bytes)`);
  console.log("first 12 records:");
  for (let i = 0; i < 12; i++) {
    const off = best.start + i * 9;
    const bytes = buf.slice(off, off + 9);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
    const w = bytes[0] / 4;
    console.log(`  +${(i*9).toString().padStart(4)}: ${hex}  w=${w}`);
  }

  // Count weapon distribution
  const dist = new Map();
  for (let i = 0; i < best.len; i++) {
    const w = buf[best.start + i * 9] / 4;
    dist.set(w, (dist.get(w) || 0) + 1);
  }
  console.log("\nweapon_lvl distribution:");
  for (const [w, c] of Array.from(dist.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`  w=${w}: ${c}`);
  }
}
