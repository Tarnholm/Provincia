// Approach: build a hash index of all 16-byte windows in B, then walk A
// 16 bytes at a time and look up each window. Where it doesn't match,
// search for the nearest matching B position (within reasonable range).
//
// This gives a coarse correspondence map at 16-byte resolution.
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

const W = 32;  // window size
const STEP = 16; // sample step

// Build an index from u64 hash of B's W-byte windows to list of positions
// To keep memory reasonable, hash key = first 8 bytes packed as BigInt
const idx = new Map();
for (let p = 0; p + W <= B.length; p++) {
  // skip if all-zero (massive overpopulation)
  if (B[p] === 0 && B[p+1] === 0 && B[p+2] === 0 && B[p+3] === 0 && B[p+4] === 0 && B[p+5] === 0 && B[p+6] === 0 && B[p+7] === 0) {
    // index every 8th to allow skipping zero seas
    if (p % 1024 !== 0) continue;
  }
  const key = B.readBigUInt64LE(p);
  if (!idx.has(key)) idx.set(key, [p]);
  else {
    const list = idx.get(key);
    if (list.length < 8) list.push(p);
  }
}
console.log(`Index built: ${idx.size} keys`);

function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

// Walk A; for each STEP we look up the W-window in B, find best B-position
// within +/- DRIFT of current expectation.
const map = [];  // {A_off, B_off, drift}
let expectedB = 0;
const DRIFT = 1 << 18;  // 256KB tolerance per side
for (let ai = 0; ai + W <= A.length; ai += STEP) {
  if (A[ai] === 0 && A[ai+1] === 0 && A[ai+2] === 0 && A[ai+3] === 0 && A[ai+4] === 0 && A[ai+5] === 0 && A[ai+6] === 0 && A[ai+7] === 0) {
    expectedB += STEP;  // assume zero seas remain aligned
    continue;
  }
  const key = A.readBigUInt64LE(ai);
  const cands = idx.get(key);
  if (!cands) { expectedB += STEP; continue; }
  // pick the candidate closest to expectedB
  let best = -1, bestD = Infinity;
  for (const c of cands) {
    if (!eq(A, ai, B, c, W)) continue;
    const d = Math.abs(c - expectedB);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best === -1 || bestD > DRIFT) { expectedB += STEP; continue; }
  map.push({ A: ai, B: best, drift: best - expectedB });
  expectedB = best + STEP;
}
console.log(`Map entries: ${map.length}`);

// Look for transitions where drift jumps
const transitions = [];
let prevDrift = 0;
let prevB = 0;
let prevA = 0;
for (const m of map) {
  if (m.drift !== prevDrift) {
    transitions.push({ A: m.A, B: m.B, dDrift: m.drift - prevDrift, prevA, prevB });
  }
  prevDrift = m.drift;
  prevA = m.A;
  prevB = m.B;
}
console.log(`Transitions: ${transitions.length}`);

// Print all transitions
console.log('\nDrift transitions:');
for (const t of transitions) {
  console.log(`  A=0x${t.A.toString(16)}  B=0x${t.B.toString(16)}  ΔdriftHere=${t.dDrift}  (prev A=0x${t.prevA.toString(16)} B=0x${t.prevB.toString(16)})`);
}

// Net drift accumulation across transitions
let netDrift = 0;
for (const t of transitions) netDrift += t.dDrift;
console.log(`\nSum of transitions: ${netDrift}`);
console.log(`Expected (B-A length diff): ${B.length - A.length}`);

fs.writeFileSync('C:/dev/Provincia/scripts/save-cracker/out-recruit-trans.json',
                  JSON.stringify(transitions, null, 1));
