// dig-mask-halo2.js — Session 42 attempt 2.
// The simple "distance from centroid" failed (R²≈0.1). The halo has
// non-monotonic spatial structure — values go up and down across rows.
// This means the source is NOT a single point — likely MULTIPLE friendly
// characters/armies whose halos sum or take maximum.
//
// New plan:
//   1) Find every "Roman" position in save_5.2. Heuristic: "Roman" =
//      any character/army whose faction is 0 (the player rec).
//   2) For each cell that changed, compute the MASK VALUE under the
//      hypothesis  v = max(0, K - min_i(dist(cell, char_i)))  for
//      various K and distance metrics.
//   3) Use the OBSERVED B-side values directly (not differences) since
//      they are the "current" halo state.
//
// Sub-problem: we don't know faction-id of each character. But we DO
// know the player is faction 0 (= rec 0 = romans_julii), and the ship
// move ONLY affected rec 0. So any character WHOSE PRESENCE causes
// rec-0's halo to ramp is by definition a Roman character/army.
//
// Cheap proxy: assume Roman positions cluster around the bbox centroid
// (335, 381 in MASK coords). What's the corresponding game-coord
// region? We expect Rome's units to be in central Italy.
//
// Best approach: scale-search. We have one anchor (ship game(171,99)
// after move). Try multiple (xScale, xOff, yScale, yOff) transforms.
// For each transform, compute distance from EVERY character to each
// changed cell using MASK coords, find min distance, predict
// v = floor(K - minDist), and score R^2.

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);

function findAllMagic(buf, hint = 0) {
  const o = [];
  let p = hint;
  while (true) {
    const i = buf.indexOf(MAGIC, p);
    if (i < 0) break;
    o.push(i);
    p = i + 4;
  }
  return o;
}

function decodeRle(buf, start, end, W = 1020, H = 700) {
  const mask = new Uint8Array(W * H);
  let cursor = 0;
  let p = start;
  while (p < end - 1 && cursor < mask.length) {
    const v = buf[p];
    const c = buf[p + 1];
    for (let k = 0; k < c && cursor < mask.length; k++) mask[cursor++] = v;
    p += 2;
  }
  return mask;
}

function collectPositions(buf) {
  const out = [];
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const type = buf.readUInt32LE(N - 12);
    if (type !== 6 && type !== 5 && type !== 4) continue;
    const x = buf.readUInt32LE(N);
    if (x < 0 || x > 1100) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    out.push({ type, uuid, x, y, off: N - 12 });
  }
  return out;
}

const W = 1020, H = 700;
const bufA = fs.readFileSync(path.join(SAVE_DIR, "save_5.2.sav"));
const bufB = fs.readFileSync(path.join(SAVE_DIR, "save_6.2.sav"));

const offsA = findAllMagic(bufA, 0x1f00000);
const offsB = findAllMagic(bufB, 0x1f00000);
const maskA = decodeRle(bufA, offsA[0] + 12, offsA[1] - 8);
const maskB = decodeRle(bufB, offsB[0] + 12, offsB[1] - 8);

const changed = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (maskA[i] !== maskB[i]) changed.push({ x, y, va: maskA[i], vb: maskB[i] });
  }
}
console.log(`Changed cells: ${changed.length}`);

// Collect all positions in save_5 (A) — these are the OLD positions
// (before the ship moved).
const posA = collectPositions(bufA);
console.log(`World-object positions in save_5: ${posA.length}`);

// Dedup by uuid (keep type-6 first, then 5, then 4)
const byUuid = new Map();
for (const p of posA) {
  if (!byUuid.has(p.uuid)) byUuid.set(p.uuid, p);
  else {
    const ex = byUuid.get(p.uuid);
    if (p.type === 6 && ex.type !== 6) byUuid.set(p.uuid, p);
  }
}
const uniquePos = [...byUuid.values()];
console.log(`Unique positions by uuid: ${uniquePos.length}`);

// X/Y range
const xs = uniquePos.map(p => p.x), ys = uniquePos.map(p => p.y);
console.log(`X range: ${Math.min(...xs)}..${Math.max(...xs)}`);
console.log(`Y range: ${Math.min(...ys)}..${Math.max(...ys)}`);

// Try scale-search. Hypothesis: x_mask = xScale * x_game + xOff,
// y_mask = yScale * y_game + yOff. Two anchors:
//   ship_A: game (172, 92)
//   ship_B: game (171, 99)
// These are in `uniquePos` (by uuid match between A and B).

// We already established the bbox centroid in mask coords is (335, 380.7).
// The ship is at game (171,99) after move. So the centroid likely IS
// the new ship position in mask coords. ASSUMING scale uniform:
//   335 = s*171 + dx → if s=2.0 then dx = 335 - 342 = -7
//   381 = s*99 + dy → if s=2.0 then dy = 381 - 198 = 183
// Inconsistent dy — so scale isn't uniform OR centroid isn't at ship.
//
// Another approach: pick a transform such that ALL game positions in
// uniquePos fall inside the 1020x700 mask region. Game coords up to
// (1100, 800) — so scale might be ~1, identity.
//
// Wait: the world-object positions ARE in 1020x700 space (per
// characterParserV2 bounds). So mask coords = game coords directly!
// That means ship game (171,99) should map to mask (171,99). But the
// centroid is (335, 381). Where IS the ship in mask space?
//
// Let me check: in save_5, who is at game (172,92)?
const at172_92 = uniquePos.filter(p => p.x === 172 && p.y === 92);
console.log(`\nPositions at game (172,92): ${at172_92.length}`);
for (const p of at172_92) {
  console.log(`  type=${p.type} uuid=0x${p.uuid.toString(16)} off=0x${p.off.toString(16)}`);
}
// And in save_6 at (171,99)?
const posB = collectPositions(bufB);
const at171_99 = posB.filter(p => p.x === 171 && p.y === 99);
console.log(`Positions at game (171,99) in save_6: ${at171_99.length}`);
for (const p of at171_99.slice(0, 10)) {
  console.log(`  type=${p.type} uuid=0x${p.uuid.toString(16)} off=0x${p.off.toString(16)}`);
}

// Histogram of position coordinates (cluster around interesting region?)
console.log(`\nClosest positions to mask centroid (335, 381) by Chebyshev:`);
const distances = uniquePos.map(p => ({
  ...p,
  dCheb: Math.max(Math.abs(p.x - 335), Math.abs(p.y - 381)),
  dEuc: Math.sqrt((p.x - 335) ** 2 + (p.y - 381) ** 2),
}));
distances.sort((a, b) => a.dCheb - b.dCheb);
for (const d of distances.slice(0, 30)) {
  console.log(`  game(${d.x},${d.y}) type=${d.type} dCheb=${d.dCheb} dEuc=${d.dEuc.toFixed(1)} uuid=0x${d.uuid.toString(16)}`);
}

// CRITICAL: The world-object positions ARE 1020x700-range, so if mask
// coords are direct... but the centroid is way off from any 171-ish
// position. UNLESS those positions are in a DIFFERENT coordinate space.
// The bounds-up-to-1100/800 check in collectWorldObjectPositions just
// rejects obviously-out-of-range u32s.
//
// Let's look at the (172,92) entry's neighborhood — it should be a
// ship's position. type-4 = naval.

console.log(`\nAll type-4 positions in save_5 (naval/fleet):`);
const naval = uniquePos.filter(p => p.type === 4);
console.log(`  count: ${naval.length}`);
console.log(`  X range: ${Math.min(...naval.map(p => p.x))}..${Math.max(...naval.map(p => p.x))}`);
console.log(`  Y range: ${Math.min(...naval.map(p => p.y))}..${Math.max(...naval.map(p => p.y))}`);
for (const n of naval.slice(0, 30)) {
  console.log(`  (${n.x},${n.y}) uuid=0x${n.uuid.toString(16)}`);
}
