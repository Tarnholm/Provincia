// Shift-aware diff: byte-level diff treats a single insert as "all subsequent
// bytes changed", which lights up ~80% of the file when a record grows. We
// fix that by anchoring on common N-byte windows so insert/delete only
// surfaces as a localised shift.
//
// Algorithm:
//   1. Build a map { 8-byte-window → [offsets in B] } over B
//   2. Walk A linearly. At each position, look ahead for a window in A that
//      also exists in B at offset >= current B-pointer. The closest such
//      pair becomes the next "anchor" — bytes between the previous anchor
//      and this one are the diff "run" (with possibly different lengths in
//      A and B, denoting insert/delete).
//   3. Anchors must be unique-ish (we discard windows that appear >K times in B
//      to avoid false-anchoring on common zero-runs).
//
// Output: { runs: [{aStart, aEnd, bStart, bEnd}], anchors: [{aOff, bOff, len}] }
// The naive byte-runs are still exposed via diffByteRuns() for callers that
// just want a quick "what changed at all".
// Bounded-shift diff: linear scan, when bytes diverge try shifts of [-128, +128]
// in B looking for a re-sync. This handles the common save-file pattern where a
// single record grows/shrinks by a few bytes (one new trait, one new ancillary,
// one fewer unit) and then everything aligns again. O(N·shift) which is fast
// enough for 16MB. We require a 16-byte run of matches to call a re-sync.
const RESYNC = 16;
const MAX_SHIFT = 256;

export function diffSmart(aBuf, bBuf) {
  const aLen = aBuf.length, bLen = bBuf.length;
  const anchors = []; // {aOff, bOff, len}
  let aPtr = 0, bPtr = 0;
  while (aPtr < aLen && bPtr < bLen) {
    // Find next divergence
    const startA = aPtr, startB = bPtr;
    while (aPtr < aLen && bPtr < bLen && aBuf[aPtr] === bBuf[bPtr]) { aPtr++; bPtr++; }
    if (aPtr > startA) anchors.push({ aOff: startA, bOff: startB, len: aPtr - startA });
    if (aPtr >= aLen || bPtr >= bLen) break;
    // Mismatch at (aPtr, bPtr). Search shifts: try sB - sA in [-MAX_SHIFT, +MAX_SHIFT]
    // and find smallest |shift| where a RESYNC-byte block matches.
    let bestShift = null;
    for (let s = 1; s <= MAX_SHIFT; s++) {
      // Check shift +s: aPtr matches against bPtr+s
      if (bPtr + s + RESYNC <= bLen) {
        let ok = true;
        for (let k = 0; k < RESYNC; k++) if (aBuf[aPtr + k] !== bBuf[bPtr + s + k]) { ok = false; break; }
        if (ok) { bestShift = { da: 0, db: s }; break; }
      }
      // Check shift -s: aPtr+s matches against bPtr
      if (aPtr + s + RESYNC <= aLen) {
        let ok = true;
        for (let k = 0; k < RESYNC; k++) if (aBuf[aPtr + s + k] !== bBuf[bPtr + k]) { ok = false; break; }
        if (ok) { bestShift = { da: s, db: 0 }; break; }
      }
      // Check matching shift on both sides
      if (aPtr + s + RESYNC <= aLen && bPtr + s + RESYNC <= bLen) {
        let ok = true;
        for (let k = 0; k < RESYNC; k++) if (aBuf[aPtr + s + k] !== bBuf[bPtr + s + k]) { ok = false; break; }
        if (ok) { bestShift = { da: s, db: s }; break; }
      }
    }
    if (!bestShift) {
      // Couldn't resync within MAX_SHIFT — skip 1 byte on both sides and keep trying
      aPtr++; bPtr++;
      continue;
    }
    aPtr += bestShift.da;
    bPtr += bestShift.db;
  }
  // Build gap runs between anchors
  const runs = [];
  let prevA = 0, prevB = 0;
  for (const { aOff, bOff, len } of anchors) {
    if (aOff > prevA || bOff > prevB) runs.push({ aStart: prevA, aEnd: aOff, bStart: prevB, bEnd: bOff });
    prevA = aOff + len; prevB = bOff + len;
  }
  if (prevA < aLen || prevB < bLen) runs.push({ aStart: prevA, aEnd: aLen, bStart: prevB, bEnd: bLen });
  return { runs, anchors };
}

// Naive byte-level diff (kept for the quick-overview report card)
export function diffByteRuns(aBuf, bBuf, { mergeGap = 16 } = {}) {
  const a = aBuf, b = bBuf;
  const minLen = Math.min(a.length, b.length);
  const runs = [];
  let inRun = false, runStart = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) { if (!inRun) { runStart = i; inRun = true; } }
    else if (inRun) { runs.push({ start: runStart, end: i }); inRun = false; }
  }
  if (inRun) runs.push({ start: runStart, end: minLen });
  if (a.length !== b.length) runs.push({ start: minLen, end: Math.max(a.length, b.length), tail: true });
  const merged = [];
  for (const r of runs) {
    if (merged.length === 0) { merged.push({ ...r }); continue; }
    const last = merged[merged.length - 1];
    if (r.start - last.end <= mergeGap) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged;
}

export function summarizeSmartDiff(smart, aBuf, bBuf) {
  const totalAnchored = smart.anchors.reduce((s, a) => s + a.len, 0);
  const totalChangedA = smart.runs.reduce((s, r) => s + (r.aEnd - r.aStart), 0);
  const totalChangedB = smart.runs.reduce((s, r) => s + (r.bEnd - r.bStart), 0);
  return {
    runCount: smart.runs.length,
    anchorCount: smart.anchors.length,
    anchoredBytes: totalAnchored,
    changedBytesA: totalChangedA,
    changedBytesB: totalChangedB,
    pctAnchored: ((totalAnchored / aBuf.length) * 100).toFixed(2) + "%",
    pctChangedA: ((totalChangedA / aBuf.length) * 100).toFixed(2) + "%",
    sizeDelta: bBuf.length - aBuf.length,
  };
}

// Backwards-compat alias
export const diff = diffByteRuns;
export const summarizeDiff = (runs, a, b) => {
  const totalChanged = runs.reduce((s, r) => s + (r.end - r.start), 0);
  const minLen = Math.min(a.length, b.length);
  return {
    runCount: runs.length,
    totalChanged,
    pctChanged: ((totalChanged / minLen) * 100).toFixed(3) + "%",
    sizeDelta: b.length - a.length,
  };
};
