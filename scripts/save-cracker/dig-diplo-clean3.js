// Session 32 step 3: Use a proper Myers-style diff approach to align A and B
// past the 10-byte deletion. We look for long matching runs to identify the
// insertion/deletion boundary, then report only real semantic changes.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

// Build a sliding-window hash of B's bytes (window size 32 — long enough to be ~unique).
// For each position in A, check if the same 32-byte window appears in B nearby.
// This lets us identify the deletion boundary.

// Simpler: assume shifts of either 0 or -10. Find longest contiguous matches at each.
// At each offset i, check whether a[i] === b[i] (shift0) or a[i] === b[i-10] (shift-10).
// The transition point reveals the structural change.

const N = a.length;
const M = b.length;

// Build per-offset alignment summary at intervals.
const STEP = 0x1000; // 4KB granularity for scanning
console.log(`Scanning shift alignment at 4KB intervals (file: 32MB)...`);

// For a given offset i in A, count matches over window of 256 bytes at shift 0 vs shift -10.
function countMatches(aOff, bOff, len) {
  let n = 0;
  for (let k = 0; k < len; k++) {
    if (aOff + k >= N || bOff + k >= M) break;
    if (a[aOff + k] === b[bOff + k]) n++;
  }
  return n;
}

// Find the FIRST offset where shift0 fails badly but shift-10 succeeds — that's after deletion.
let prevShift = 0;
const shifts = [];
for (let i = 0x4000; i < N - 0x100; i += 0x100) {
  // Try shift 0 and shift -10
  const m0 = countMatches(i, i, 64);
  const m10 = (i - 10 >= 0) ? countMatches(i, i - 10, 64) : -1;
  let shift = null;
  if (m0 >= 60) shift = 0;
  else if (m10 >= 60) shift = -10;
  // else unaligned region — record shift transitions
  if (shift !== null && shift !== prevShift) {
    shifts.push({ at: i, from: prevShift, to: shift, m0, m10 });
    prevShift = shift;
  }
}
console.log(`Shift transitions detected: ${shifts.length}`);
for (const s of shifts) {
  console.log(`  at 0x${s.at.toString(16)}: ${s.from} -> ${s.to} (m0=${s.m0}, m10=${s.m10})`);
}

// Then narrow each transition to the exact byte. Walk byte-by-byte around each.
console.log(`\nNarrowing each transition to byte-exact boundary...`);
for (const s of shifts) {
  // Find the exact boundary where shift toggles from `from` to `to`.
  // Walk from max(0, s.at - 0x200) forward and find the precise toggle.
  let last = null;
  for (let i = Math.max(0, s.at - 0x200); i < Math.min(N - 32, s.at + 0x100); i++) {
    const mFrom = (i + s.from >= 0 && i + s.from < M) ? countMatches(i, i + s.from, 32) : -1;
    const mTo   = (i + s.to   >= 0 && i + s.to   < M) ? countMatches(i, i + s.to,   32) : -1;
    let cur = null;
    if (mFrom >= 28) cur = s.from;
    else if (mTo >= 28) cur = s.to;
    if (last !== null && cur !== null && cur !== last) {
      console.log(`  transition near 0x${i.toString(16)}: ${last}->${cur} (mFrom=${mFrom}, mTo=${mTo})`);
    }
    last = cur;
  }
}
