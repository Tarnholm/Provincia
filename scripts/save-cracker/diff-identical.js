// Byte-level diff for two same-size files. Reports every differing run.
// Usage: node scripts/save-cracker/diff-identical.js <a.sav> <b.sav>
import fs from "node:fs";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: node diff-identical.js <a> <b>"); process.exit(2); }
const A = fs.readFileSync(a);
const B = fs.readFileSync(b);
console.log(`A: ${A.length} bytes\nB: ${B.length} bytes`);
if (A.length !== B.length) { console.error("size mismatch"); process.exit(1); }

const runs = [];
let i = 0;
while (i < A.length) {
  if (A[i] !== B[i]) {
    const start = i;
    while (i < A.length && A[i] !== B[i]) i++;
    runs.push({ start, end: i, len: i - start });
  } else {
    i++;
  }
}

const totalDiff = runs.reduce((s, r) => s + r.len, 0);
console.log(`\n${runs.length} differing runs, ${totalDiff} bytes total (${(100*totalDiff/A.length).toFixed(4)}%)\n`);

// Show every run with hex context
for (const r of runs) {
  const ctxStart = Math.max(0, r.start - 8);
  const ctxEnd = Math.min(A.length, r.end + 8);
  const aHex = [...A.subarray(ctxStart, ctxEnd)].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const bHex = [...B.subarray(ctxStart, ctxEnd)].map(b => b.toString(16).padStart(2, "0")).join(" ");
  const marker = " ".repeat((r.start - ctxStart) * 3) + "^".repeat(r.len * 3 - 1);
  console.log(`@0x${r.start.toString(16).padStart(8, "0")} (+${r.len}B):`);
  console.log(`  A: ${aHex}`);
  console.log(`  B: ${bHex}`);
  console.log(`     ${marker}`);
}
