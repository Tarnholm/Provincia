// How localized is the "declare war on Carthage" change? Common prefix/suffix
// of the before/after pair brackets the changed region. Small bracket => war is
// a localized flag (crackable). Huge bracket => wholesale object-graph churn.
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const B = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 Start.sav");
const A = fs.readFileSync(DIR + "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");
console.log(`before=${B.length}  after=${A.length}  delta=${A.length - B.length}`);

// common prefix
let p = 0; const min = Math.min(A.length, B.length);
while (p < min && A[p] === B[p]) p++;
// common suffix
let s = 0;
while (s < min - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
console.log(`common prefix ends at 0x${p.toString(16)} (${(100*p/B.length).toFixed(1)}% in)`);
console.log(`common suffix starts at before:0x${(B.length-s).toString(16)} / after:0x${(A.length-s).toString(16)} (last ${s} bytes identical, ${(100*s/B.length).toFixed(1)}%)`);
console.log(`=> changed/inserted middle spans before[0x${p.toString(16)}..0x${(B.length-s).toString(16)}] = ${B.length - s - p} bytes of ${B.length}`);

function ctx(buf, off, n = 48) {
  const start = Math.max(0, off - 8);
  let hex = "", asc = "";
  for (let i = 0; i < n; i++) { const b = buf[start + i]; hex += b.toString(16).padStart(2,"0")+" "; asc += (b>=0x20&&b<=0x7e)?String.fromCharCode(b):"."; }
  return `    0x${start.toString(16)}: ${hex}\n             ${asc}`;
}
console.log("\nfirst divergence context:");
console.log("  BEFORE:\n" + ctx(B, p));
console.log("  AFTER:\n" + ctx(A, p));

// Within the common-prefix region (perfectly aligned, no shift), count diffs?
// (none by definition). Instead: scan the WHOLE before file vs after using a
// per-64KB-bucket aligned diff to see if changes are clustered or spread.
console.log("\nper-64KB aligned diff over min length (shows churn spread):");
for (let base = 0; base < min; base += 0x10000) {
  let d = 0;
  for (let i = base; i < Math.min(base + 0x10000, min); i++) if (A[i] !== B[i]) d++;
  if (d > 0) console.log(`  0x${base.toString(16).padStart(6,"0")}: ${d} differing bytes`);
}
