// dig-econ-stride-runs.js
// Find a contiguous array of ~36 fixed-stride records. We look for "section wrapper"
// pairs (taw grammar: u32==pos self-ptr, then payload). The faction records used
// self-ptrs at +24/+40. The econ records likely have their own simple wrapper.
//
// General run detector: for each starting offset that begins a self-ptr-anchored
// record, measure how far a constant stride continues (each record at p+k*S also
// satisfies the same invariant). Report runs of length in [30..45] (target 36).
//
// We test TWO invariants:
//   INV-A: u32(rec) == rec               (record starts with self-ptr to itself)
//   INV-B: u32(rec+0)==rec+0 && u32(rec+8)==rec+8 (region-record style double self-ptr)
// and a generic invariant:
//   INV-C: the first u32 of each record equals a small constant version tag shared
//          by all records in the run (e.g. all start with 0x... version), detected
//          by checking u32(rec) is identical for >= 30 consecutive strided records.

const fs = require("fs");
const path = require("path");

const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const buf = fs.readFileSync(path.join(BASE, "save_arretium pre retrained..sav"));
const N = buf.length;
const u32 = (o) => buf.readUInt32LE(o);

// INV-A self-ptr runs
function runLenSelfPtr(start, stride) {
  let n = 0;
  for (let k = 0; ; k++) {
    const p = start + k * stride;
    if (p + 4 > N) break;
    if (u32(p) !== p) break;
    n++;
  }
  return n;
}

console.log("=== INV-A: runs of records each starting with a self-ptr (u32(p)==p) ===");
const selfPtrOffsets = [];
for (let p = 0x3000; p + 4 < N; p += 4) if (u32(p) === p) selfPtrOffsets.push(p);
console.log(`${selfPtrOffsets.length} self-ptr positions total`);
// Build a set for O(1) membership
const sps = new Set(selfPtrOffsets);
// For each self-ptr, find the next self-ptr; stride = diff; then count run.
const reportedA = new Set();
let foundA = 0;
for (let i = 0; i < selfPtrOffsets.length - 1; i++) {
  const start = selfPtrOffsets[i];
  if (reportedA.has(start)) continue;
  const stride = selfPtrOffsets[i + 1] - start;
  if (stride < 8 || stride > 4000) continue;
  // count run
  let n = 1, p = start;
  while (sps.has(p + stride)) { p += stride; n++; }
  if (n >= 20) {
    console.log(`  run @0x${start.toString(16)} stride=${stride} length=${n}${n>=30&&n<=45?"   <== TARGET RANGE":""}`);
    // mark consumed
    let q = start;
    for (let k = 0; k < n; k++) { reportedA.add(q); q += stride; }
    foundA++;
  }
}
if (!foundA) console.log("  (no self-ptr runs >=20)");

// INV-C: identical-first-u32 strided runs (version-tagged record arrays)
console.log("\n=== INV-C: strided runs where every record shares the same first u32 (version tag), len>=30 ===");
// Try common strides; for each, slide and detect runs of >=30 with identical u32(p) and small value.
const STRIDES = [];
for (let s = 12; s <= 600; s += 4) STRIDES.push(s);
const seen = new Set();
let foundC = 0;
for (const S of STRIDES) {
  for (let p = 0x3000; p + S * 30 < N; p += 4) {
    const v = u32(p);
    if (v === 0 || v > 0xffff) continue; // version tag should be small
    // quick check: next record same v?
    if (u32(p + S) !== v) continue;
    // count run
    let n = 1, q = p;
    while (q + S + 4 <= N && u32(q + S) === v) { q += S; n++; }
    if (n >= 30) {
      const key = `${p}_${S}`;
      // dedup overlapping
      let dup = false;
      for (const k of seen) { const [pp, ss] = k.split("_").map(Number); if (ss === S && Math.abs(pp - p) < S) { dup = true; break; } }
      if (dup) continue;
      seen.add(key);
      console.log(`  run @0x${p.toString(16)} stride=${S} firstU32=${v} length=${n}${n>=33&&n<=45?"   <== TARGET":""}`);
      foundC++;
      if (foundC > 60) { console.log("  ...(truncated)"); break; }
    }
  }
  if (foundC > 60) break;
}
if (!foundC) console.log("  (none)");
