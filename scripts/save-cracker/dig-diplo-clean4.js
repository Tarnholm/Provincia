// Session 32 step 4: Use a proper LCS-style diff to identify the structural change.
// Strategy: find longest match anchors, walk file, classify each diff:
//   - "aligned diff" = bytes at same offset differ, but shift remains 0
//   - "shift-10 region" = data has shifted left 10 bytes
//   - "true insertion/deletion" = the boundary where shift transitions
// Print only the structural boundary (where shift toggles) and aligned diffs in shift-0 regions.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));
const N = a.length, M = b.length;
console.log(`A=${N}, B=${M}, delta=${M - N}`);

// Algorithm: 2-pointer walk.
// At each step i in A and j in B, determine if a[i]===b[j].
// If yes, advance both. If no, lookahead: does a[i+k]===b[j] for some small k? -> A had extra bytes (deletion in B).
// Or does a[i]===b[j+k]? -> B had extra bytes (insertion in B).
// Track all such events.

const events = [];
let i = 0, j = 0;
const LOOKAHEAD = 64;

function eq(off) {
  return a[i + off] === b[j + off];
}

// Simpler heuristic: if mismatch, look ahead by sliding either pointer up to LOOKAHEAD.
while (i < N && j < M) {
  if (a[i] === b[j]) {
    i++; j++;
    continue;
  }
  // Find smallest (di, dj) with a[i+di..]===b[j+dj..] for at least 16 bytes.
  let best = null;
  for (let total = 1; total <= LOOKAHEAD * 2 && !best; total++) {
    for (let di = 0; di <= Math.min(total, LOOKAHEAD); di++) {
      const dj = total - di;
      if (dj > LOOKAHEAD) continue;
      if (i + di + 16 > N || j + dj + 16 > M) continue;
      // Check 16-byte match.
      let ok = true;
      for (let k = 0; k < 16; k++) {
        if (a[i + di + k] !== b[j + dj + k]) { ok = false; break; }
      }
      if (ok) { best = { di, dj }; break; }
    }
  }
  if (!best) {
    // Fall back: 1-byte substitution.
    events.push({ type: 'sub', ai: i, bi: j, a: a[i], b: b[j] });
    i++; j++;
    continue;
  }
  const { di, dj } = best;
  if (di === 0 && dj === 0) {
    // 16-byte block matches but a[i]!==b[j]? impossible; safety.
    i++; j++;
    continue;
  }
  // If di>0 and dj>0: it's a sub-region with multiple substitutions in different lengths.
  // We'll classify as 'replace' (size di in A becomes size dj in B).
  events.push({ type: 'replace', ai: i, bi: j, aLen: di, bLen: dj, aBytes: a.slice(i, i + di), bBytes: b.slice(j, j + dj) });
  i += di; j += dj;
  if (events.length > 50000) {
    console.log(`!! too many events; aborting at i=${i.toString(16)}, j=${j.toString(16)}`);
    break;
  }
}

console.log(`Total events: ${events.length}`);

// Compute net size change.
let netDelta = 0;
const subEvents = [];
const replaceEvents = [];
for (const e of events) {
  if (e.type === 'replace') {
    netDelta += e.bLen - e.aLen;
    replaceEvents.push(e);
  } else {
    subEvents.push(e);
  }
}
console.log(`Net delta from events: ${netDelta} (expected -10)`);
console.log(`Substitutions: ${subEvents.length}`);
console.log(`Replace events: ${replaceEvents.length}`);

// Print first 80 events.
console.log(`\n=== Events (first 80) ===`);
for (let k = 0; k < Math.min(80, events.length); k++) {
  const e = events[k];
  if (e.type === 'sub') {
    console.log(`  ${k}: SUB at A=0x${e.ai.toString(16)} B=0x${e.bi.toString(16)}: ${e.a.toString(16).padStart(2,'0')} -> ${e.b.toString(16).padStart(2,'0')}`);
  } else {
    const aHex = Array.from(e.aBytes).map(x => x.toString(16).padStart(2,'0')).join(' ');
    const bHex = Array.from(e.bBytes).map(x => x.toString(16).padStart(2,'0')).join(' ');
    console.log(`  ${k}: REP at A=0x${e.ai.toString(16)}(${e.aLen}) B=0x${e.bi.toString(16)}(${e.bLen}) delta=${e.bLen - e.aLen}`);
    console.log(`     A: ${aHex.slice(0, 200)}`);
    console.log(`     B: ${bHex.slice(0, 200)}`);
  }
}

// Save full event list to JSON for later analysis.
const outPath = path.join('C:/dev/Provincia/scripts/save-cracker', 'diplo-clean-events.json');
fs.writeFileSync(outPath, JSON.stringify(events.map(e => {
  if (e.type === 'sub') return e;
  return {
    type: e.type, ai: e.ai, bi: e.bi, aLen: e.aLen, bLen: e.bLen,
    aHex: Array.from(e.aBytes).map(x => x.toString(16).padStart(2,'0')).join(''),
    bHex: Array.from(e.bBytes).map(x => x.toString(16).padStart(2,'0')).join(''),
  };
}), null, 2));
console.log(`\nWrote ${events.length} events to ${outPath}`);
