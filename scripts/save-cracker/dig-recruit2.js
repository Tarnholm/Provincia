// Session 36, probe #2: aligned diff save_2.2 (queue wall) -> save_3.2 (queue levies).
// −18 byte net. We want to find every inserted/deleted region and every
// in-place changed run. Use a 2-pointer shift-tolerant aligner with lookahead.
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

const RUN = 32;        // length of match we need to re-anchor
const WINDOW = 1024;   // lookahead window when running off

function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

const events = [];
let ai = 0, bi = 0;
while (ai < A.length && bi < B.length) {
  if (A[ai] === B[bi]) { ai++; bi++; continue; }
  // mismatch: find next RUN-byte match within WINDOW in either direction
  // try B-side insert first (B is ahead), then A-side insert.
  let bestType = null, bestDelta = Infinity, bestA = ai, bestB = bi;
  // try insert in B (skip bytes in B)
  for (let d = 1; d <= WINDOW; d++) {
    if (bi + d + RUN >= B.length) break;
    if (eq(A, ai, B, bi + d, RUN)) {
      if (d < bestDelta) { bestType = 'INS_B'; bestDelta = d; bestA = ai; bestB = bi + d; }
      break;
    }
  }
  // try insert in A (skip bytes in A)
  for (let d = 1; d <= WINDOW; d++) {
    if (ai + d + RUN >= A.length) break;
    if (eq(A, ai + d, B, bi, RUN)) {
      if (d < bestDelta) { bestType = 'INS_A'; bestDelta = d; bestA = ai + d; bestB = bi; }
      break;
    }
  }
  // try in-place replace (consume same N bytes both sides)
  for (let d = 1; d <= 64; d++) {
    if (ai + d + RUN >= A.length) break;
    if (bi + d + RUN >= B.length) break;
    if (eq(A, ai + d, B, bi + d, RUN)) {
      if (d < bestDelta) { bestType = 'REPL'; bestDelta = d; bestA = ai + d; bestB = bi + d; }
      break;
    }
  }
  if (bestType === null) {
    console.log(`UNRESOLVED at A=0x${ai.toString(16)} B=0x${bi.toString(16)} — bailing`);
    break;
  }
  events.push({ type: bestType, A_off: ai, B_off: bi, delta: bestDelta,
                A_chunk: A.slice(ai, bestA).toString('hex').slice(0, 80),
                B_chunk: B.slice(bi, bestB).toString('hex').slice(0, 80) });
  ai = bestA; bi = bestB;
}

console.log(`Total events: ${events.length}`);
const byType = {};
for (const e of events) { byType[e.type] = (byType[e.type] || 0) + 1; }
console.log('By type:', byType);

let inA = 0, inB = 0;
for (const e of events) {
  if (e.type === 'INS_A') inA += e.delta;
  else if (e.type === 'INS_B') inB += e.delta;
}
console.log(`Total inserted in A only (deleted vs B): ${inA}`);
console.log(`Total inserted in B only (added vs A):   ${inB}`);
console.log(`Net delta (B - A) implied:               ${inB - inA}`);
console.log(`Actual B - A:                            ${B.length - A.length}`);

// show first 50 events
console.log('\nFirst 30 events:');
for (const e of events.slice(0, 30)) {
  console.log(`  ${e.type} A=0x${e.A_off.toString(16)} B=0x${e.B_off.toString(16)} d=${e.delta}`);
  console.log(`     A: ${e.A_chunk}`);
  console.log(`     B: ${e.B_chunk}`);
}

// save events to JSON for downstream
fs.writeFileSync('C:/dev/Provincia/scripts/save-cracker/out-recruit-events.json',
                  JSON.stringify(events, null, 1));
console.log('\nEvents written: out-recruit-events.json');
