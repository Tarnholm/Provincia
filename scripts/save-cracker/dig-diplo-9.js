// dig-diplo-9.js — session 108 step 9
//
// Step 8 showed within-turn-11 diff has tight clusters at specific offsets
// in each major: +4-5, +287-288, +311-312, +956-957, etc.
//
// Hypothesis: these are scattered live-state fields. The big surprise is
// HOW LITTLE changes within a turn. Let's look at major[0] (player) in detail
// across save_mp_before / save_10_fresh / ror_t1e / ror_t11s.
//
// Specifically: find regions that DIFFER in T0 → T1 but are STABLE within
// turn 11. Those are turn-boundary-only changes — i.e., diplomatic events
// that resolve at end-of-turn.
//
// Plan:
//   (A) Compute byte diff between save_10_fresh and ror_t1e for major[0].
//   (B) Compute byte diff between ror_t11s and ror_t11e for major[0].
//   (C) Diff sets: bytes in (A) but not (B) are "turn-boundary-only" changes.
//       Those bytes are candidate diplomatic state.
//
// Usage: node dig-diplo-9.js
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "fixtures", "feral");

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}

function diffPositions(a, aOff, b, bOff, len) {
  const positions = [];
  for (let i = 0; i < len; i++) {
    if (a[aOff + i] !== b[bOff + i]) {
      if (i >= 24 && i < 28) continue;
      if (i >= 40 && i < 44) continue;
      positions.push(i);
    }
  }
  return positions;
}

const fresh = fs.readFileSync(path.join(root, "save_10_fresh.sav"));
const t1 = fs.readFileSync(path.join(root, "ror_t1e.sav"));
const t11s = fs.readFileSync(path.join(root, "ror_t11s.sav"));
const t11e = fs.readFileSync(path.join(root, "ror_t11e.sav"));
const t2s = fs.readFileSync(path.join(root, "ror_t2s.sav"));

const mFresh = readMajor(fresh);
const mT1 = readMajor(t1);
const mT11s = readMajor(t11s);
const mT11e = readMajor(t11e);
const mT2s = readMajor(t2s);
console.log(`Majors: fresh=${mFresh.length} t1=${mT1.length} t2s=${mT2s.length} t11s=${mT11s.length} t11e=${mT11e.length}`);


const len = 2048;
console.log(`Analyzing first ${len} bytes of major[k] for k=0..22`);

// For each major: find the "turn-boundary-only" positions
// Turn boundary diffs: ror_t1e → ror_t2s OR save_10_fresh → ror_t1e
// Within-turn diffs: ror_t11s → ror_t11e
//
// Bytes that diff at turn boundary but NOT within turn = diplomacy candidate

console.log(`\n=== Per-major diff signature ===`);
console.log("idx | f→t1e | t1e→t2s | t11s→t11e | (boundary only) = (f→t1e) - (t11s→t11e)");
const allCands = [];
const N = Math.min(mFresh.length, mT1.length, mT2s.length, mT11s.length, mT11e.length);
for (let k = 0; k < N; k++) {
  const dFT1 = new Set(diffPositions(fresh, mFresh[k].pos, t1, mT1[k].pos, len));
  const dT1T2 = new Set(diffPositions(t1, mT1[k].pos, t2s, mT2s[k].pos, len));
  const dWithin = new Set(diffPositions(t11s, mT11s[k].pos, t11e, mT11e[k].pos, len));
  // turn-boundary-only candidates: in dFT1 but not in dWithin
  const candidates = [];
  for (const p of dFT1) if (!dWithin.has(p)) candidates.push(p);
  candidates.sort((a, b) => a - b);
  console.log(`  [${k.toString().padStart(2)}]  ${dFT1.size.toString().padStart(4)} | ${dT1T2.size.toString().padStart(4)} | ${dWithin.size.toString().padStart(4)} | boundaryOnly=${candidates.length}`);
  allCands.push(candidates);
}

// Now compute: which BYTE POSITIONS are "boundary-only" across MOST majors?
// If position +Q is a diplo-related byte, it should differ at boundary for most
// majors (every major has its own diplomatic state per other faction).
const posVotes = new Map(); // position → count
for (const cands of allCands) {
  for (const p of cands) posVotes.set(p, (posVotes.get(p) || 0) + 1);
}
const sortedPos = [...posVotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
console.log("\nTop boundary-only byte positions (across 23 majors):");
sortedPos.forEach(([p, c]) => console.log(`  +${p} (0x${p.toString(16)}): ${c} majors`));

// Look at the +28 area — that was in every "T0 → T1" diff. Is it the turn number?
// And +287 area was in the "within turn 11" diff for major[1] specifically.
console.log("\n=== Bytes +24..+64 of major[0] across saves (treasury / header area) ===");
const showBytes = (b, off, len) => {
  let s = "";
  for (let i = 0; i < len; i++) s += b[off + i].toString(16).padStart(2, "0") + " ";
  return s;
};
console.log(`  fresh  major[0] +24..+63: ${showBytes(fresh, mFresh[0].pos + 24, 40)}`);
console.log(`  t1e    major[0] +24..+63: ${showBytes(t1, mT1[0].pos + 24, 40)}`);
console.log(`  t11s   major[0] +24..+63: ${showBytes(t11s, mT11s[0].pos + 24, 40)}`);
console.log(`  t11e   major[0] +24..+63: ${showBytes(t11e, mT11e[0].pos + 24, 40)}`);

// Treasury is at +0. Check +0..+24 for all 23 majors in fresh vs t1e
console.log("\n=== Treasury (+0) and +28 (u32) for each major: fresh vs t1e ===");
console.log("idx | fresh treasury | t1e treasury | fresh +28 | t1e +28 (u32)");
for (let k = 0; k < N; k++) {
  const trF = fresh.readInt32LE(mFresh[k].pos);
  const trT = t1.readInt32LE(mT1[k].pos);
  const v28F = fresh.readUInt32LE(mFresh[k].pos + 28);
  const v28T = t1.readUInt32LE(mT1[k].pos + 28);
  console.log(`  ${k.toString().padStart(2)} | ${trF.toString().padStart(10)} | ${trT.toString().padStart(10)} | ${v28F.toString().padStart(10)} | ${v28T.toString().padStart(10)}`);
}
