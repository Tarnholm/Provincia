// Aligned diff with much larger window + 4-byte anchor.
// At 0x52ed the prior session 32 showed a 104KB AI cache cluster (4-byte hash
// + 8 structured bytes per cell at stride 12). Those are in-place 4-byte
// replaces, but the chunks may span many bytes — we need a longer window
// to bridge them.
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

const RUN = 24;
const WINDOW_REPL = 512;
const WINDOW_INS = 8192;

function eq(a, ai, b, bi, n) {
  for (let i = 0; i < n; i++) if (a[ai+i] !== b[bi+i]) return false;
  return true;
}

// Build a hash index for B's 24-byte windows in a sliding range
function findInB(needle, ai, bi, maxAhead) {
  const stop = Math.min(B.length - RUN, bi + maxAhead);
  for (let p = bi; p <= stop; p++) {
    if (B[p] === needle[0] && eq(needle, 0, B, p, RUN)) return p;
  }
  return -1;
}
function findInA(needle, ai, bi, maxAhead) {
  const stop = Math.min(A.length - RUN, ai + maxAhead);
  for (let p = ai; p <= stop; p++) {
    if (A[p] === needle[0] && eq(A, p, needle, 0, RUN)) return p;
  }
  return -1;
}

const events = [];
let ai = 0, bi = 0;
let unresolved = 0;
const startTime = Date.now();
while (ai < A.length - RUN && bi < B.length - RUN) {
  if (A[ai] === B[bi]) { ai++; bi++; continue; }

  // Get a 24-byte needle from A starting at ai, look forward in B
  const needleA = A.slice(ai, ai + RUN);
  const needleB = B.slice(bi, bi + RUN);

  // Try small REPL first (1-WINDOW_REPL)
  let bestType = null, bestDelta = WINDOW_INS + 1, bestA = ai, bestB = bi;
  // REPL: same offset on both
  for (let d = 1; d <= WINDOW_REPL; d++) {
    if (ai + d + RUN >= A.length || bi + d + RUN >= B.length) break;
    if (eq(A, ai + d, B, bi + d, RUN)) {
      bestType = 'REPL'; bestDelta = d; bestA = ai + d; bestB = bi + d;
      break;
    }
  }
  // INS_B (insertion in B's stream)
  if (bestType === null || bestDelta > 32) {
    const pB = findInB(needleA, ai, bi + 1, WINDOW_INS);
    if (pB !== -1 && (pB - bi) < bestDelta) {
      bestType = 'INS_B'; bestDelta = pB - bi; bestA = ai; bestB = pB;
    }
  }
  // INS_A (insertion in A's stream)
  if (bestType === null || bestDelta > 32) {
    const pA = findInA(needleB, ai + 1, bi, WINDOW_INS);
    if (pA !== -1 && (pA - ai) < bestDelta) {
      bestType = 'INS_A'; bestDelta = pA - ai; bestA = pA; bestB = bi;
    }
  }

  if (bestType === null) {
    unresolved++;
    if (unresolved <= 3) console.log(`UNRESOLVED at A=0x${ai.toString(16)} B=0x${bi.toString(16)}`);
    // skip 1 byte and try again
    ai++; bi++;
    if (unresolved > 50) {
      console.log('Too many unresolved; bailing');
      break;
    }
    continue;
  }
  events.push({ type: bestType, A_off: ai, B_off: bi, delta: bestDelta,
                A_chunk: A.slice(ai, ai + Math.min(bestDelta, 24)).toString('hex'),
                B_chunk: B.slice(bi, bi + Math.min(bestDelta, 24)).toString('hex') });
  ai = bestA; bi = bestB;
  if (events.length % 100 === 0) console.log(`  events=${events.length}, ai=0x${ai.toString(16)}, bi=0x${bi.toString(16)}, elapsed=${((Date.now()-startTime)/1000).toFixed(0)}s`);
}

console.log(`Total events: ${events.length}; unresolved: ${unresolved}`);
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

fs.writeFileSync('C:/dev/Provincia/scripts/save-cracker/out-recruit-events.json',
                  JSON.stringify(events, null, 1));
console.log('\nEvents written: out-recruit-events.json');

// Print all non-REPL events (inserts/deletes)
console.log('\nAll INS_A / INS_B events:');
for (const e of events) {
  if (e.type === 'REPL') continue;
  console.log(`  ${e.type} A=0x${e.A_off.toString(16)} B=0x${e.B_off.toString(16)} d=${e.delta}`);
  console.log(`     A: ${e.A_chunk}`);
  console.log(`     B: ${e.B_chunk}`);
}
