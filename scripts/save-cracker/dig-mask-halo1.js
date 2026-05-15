// dig-mask-halo1.js — Session 42 attempt 1.
// Goal: pin the per-faction mask value formula.
// Hypothesis: value = floor(distance-from-nearest-friendly-character).
//
// Plan:
//   1) Decode rec 0 RLE in save_5.2 and save_6.2.
//   2) Find all changed cells (the 100 cells in ~16x14 bbox at (335,381)).
//   3) Collect every faction-0 (roman) character / army position from
//      save_5.2 type-6/5/4 world-object records.
//   4) Try a battery of (distance metric, scale, formula) variants and
//      pick the one with best R^2 (>0.95 target).

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

function loadRec0Mask(name) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, name));
  const offs = findAllMagic(buf, 0x1f00000);
  const rec0Magic = offs[0];
  const rec1Start = offs[1] - 8;
  const payloadStart = rec0Magic + 12;
  return { buf, mask: decodeRle(buf, payloadStart, rec1Start) };
}

// Collect all world-object positions from save buffer, keyed by uuid.
// From src/characterParserV2.js collectWorldObjectPositions:
//   type uint32 at N-12
//   uuid uint32 at N-8
//   self-offset uint32 at N-4 (== N-4)
//   x uint32 at N
//   y uint32 at N+4
function collectWorldObjectPositions(buf) {
  const out = []; // {type, uuid, x, y, off}
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

const A = loadRec0Mask("save_5.2.sav");
const B = loadRec0Mask("save_6.2.sav");

// ---- Find changed cells in rec 0 ----
const W = 1020, H = 700;
const changed = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (A.mask[i] !== B.mask[i]) {
      changed.push({ x, y, va: A.mask[i], vb: B.mask[i] });
    }
  }
}
console.log(`Changed cells: ${changed.length}`);
const bx0 = Math.min(...changed.map(c => c.x)), bx1 = Math.max(...changed.map(c => c.x));
const by0 = Math.min(...changed.map(c => c.y)), by1 = Math.max(...changed.map(c => c.y));
console.log(`bbox: X=[${bx0}..${bx1}] (w=${bx1 - bx0 + 1}) Y=[${by0}..${by1}] (h=${by1 - by0 + 1})`);
const cx = changed.reduce((s, c) => s + c.x, 0) / changed.length;
const cy = changed.reduce((s, c) => s + c.y, 0) / changed.length;
console.log(`centroid: (${cx.toFixed(1)}, ${cy.toFixed(1)})`);

// Value histograms in the bbox
console.log(`\nValue distribution in changed cells (A → B):`);
const trans = new Map();
for (const c of changed) {
  const k = `${c.va}→${c.vb}`;
  trans.set(k, (trans.get(k) || 0) + 1);
}
for (const [k, n] of [...trans.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${n}`);
}

// Sample values in the bbox (full picture, A and B)
console.log(`\nSample rows from A and B in the bbox:`);
for (let y = by0; y <= by1; y++) {
  let rowA = "", rowB = "";
  for (let x = bx0; x <= bx1; x++) {
    const i = y * W + x;
    rowA += String(A.mask[i]).padStart(2, " ");
    rowB += String(B.mask[i]).padStart(2, " ");
  }
  console.log(`  y=${y}  A: ${rowA}   B: ${rowB}`);
}

// ---- Roman positions (faction 0 = roman_julii / Roman Republic) ----
// We don't know which positions belong to which faction directly from
// the world-object record alone. We'll collect ALL positions, then we
// know the ship moved from (172,92) to (171,99). Find that position in
// save_5.2 (should be (172,92)) and save_6.2 (should be (171,99)). The
// uuid identifies the Roman ship; any OTHER Roman position is somewhere
// else on the map.
//
// Use a different filter: pos in save_5 that became (171,99) in save_6.
const posA = collectWorldObjectPositions(A.buf);
const posB = collectWorldObjectPositions(B.buf);
console.log(`\nWorld-object positions: A=${posA.length}  B=${posB.length}`);

// Build uuid maps
const mapA = new Map();
for (const p of posA) {
  // type-6 wins on collision
  if (p.type === 6 || !mapA.has(p.uuid)) mapA.set(p.uuid, p);
}
const mapB = new Map();
for (const p of posB) {
  if (p.type === 6 || !mapB.has(p.uuid)) mapB.set(p.uuid, p);
}

// Find the moving ship: uuid that went from (172,92) to (171,99)
let shipUuid = null, shipA = null, shipB = null;
for (const [uuid, pa] of mapA) {
  const pb = mapB.get(uuid);
  if (!pb) continue;
  if (pa.x === 172 && pa.y === 92 && pb.x === 171 && pb.y === 99) {
    shipUuid = uuid;
    shipA = pa;
    shipB = pb;
    break;
  }
}
console.log(`Ship uuid: 0x${shipUuid?.toString(16) || "??"}  type=${shipA?.type}  (172,92)→(171,99)`);

// All positions whose (x,y) changed between A and B:
const moved = [];
for (const [uuid, pa] of mapA) {
  const pb = mapB.get(uuid);
  if (!pb) continue;
  if (pa.x !== pb.x || pa.y !== pb.y) {
    moved.push({ uuid, type: pa.type, ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y });
  }
}
console.log(`Positions that moved between A and B: ${moved.length}`);
for (const m of moved.slice(0, 10)) {
  console.log(`  0x${m.uuid.toString(16)} type=${m.type} (${m.ax},${m.ay}) → (${m.bx},${m.by})`);
}

// Save all positions to JSON so subsequent attempts can iterate fast.
fs.writeFileSync(path.join(__dirname, "out-mask-halo-positions-A.json"), JSON.stringify([...mapA.values()], null, 0));
fs.writeFileSync(path.join(__dirname, "out-mask-halo-positions-B.json"), JSON.stringify([...mapB.values()], null, 0));
fs.writeFileSync(path.join(__dirname, "out-mask-halo-changed.json"), JSON.stringify(changed, null, 0));
console.log(`\nSaved positions + changed-cells to JSON.`);

// ----- Quick correlation test -----
// Given the ship MOVES from (172,92) to (171,99) and the mask diff is
// localized at centroid (335, 380.7), there's a coord transform from
// game-tile-space to mask-pixel-space. The ship is at game (171,99) in
// save_6; the influence halo CHANGES there. So scale ≈ (335-?)/171,
// (380.7-?)/99 — depends on offset.
//
// But we don't need to guess. The CHANGED cells in B (with values vb)
// correspond to the NEW halo around the ship. So the distance from the
// ship (in mask coords) should correlate with vb (or some max-vb shift).
//
// Hypothesis: mask coord = game coord × 2 in X, × 4 in Y? Let's test
// known centroid (335,381) with ship (171,99): 335/171=1.96, 381/99=3.85.
// Strange aspect ratio. Probably the mask is regional-pixel where 1
// game tile = 2 px in X and ~4 px in Y, OR there's an offset.
//
// Plan A: assume linear y_mask = a*y_game + b, x_mask = c*x_game + d.
// We have 1 sample (centroid). Need more. The OLD position (172,92)
// also had a halo that's being REMOVED — the cells in A with va > 0
// outside the new halo (now zero in B) are part of that.
//
// Try simpler: treat as scale=2 (game tiles → mask pixels are 2x).
// Then ship-B at (342, 198). But the diff is at (335, 381). Doesn't fit.
//
// Maybe the mask coords are TGA-pixel space matching map_regions_large
// (1020x700), and the game tile coords are TGA-pixel-space too (so ship
// at (171,99) is direct pixel (171,99) on the map). Then the halo
// centroid should be near (171,99) — but it's at (335, 381). Way off.
//
// Wait — maybe the game coords ARE different. Let me check: the
// settlement coords table at offset +341/+345 in settlements is "tile
// coords". RIS imperial map per AI cache is 1020x700 pixel space.
// dig-charmap2.js mentions Roma settlement position.
//
// Most likely: the game uses (x,y) on a coarser 240×170-ish grid, and
// the mask is the 1020x700 high-res. So scale x ≈ 4.25, y ≈ 4.12.
// 171 × ~1.96 = 335 (x-scale ≈ 1.96)
// 99  × ~3.85 = 381 (y-scale ≈ 3.85)
// Inconsistent. Maybe an OFFSET:
//   y_mask = y_game + 282? Test: 99 + 282 = 381 ✓.
//   x_mask = x_game + 164? Test: 171 + 164 = 335 ✓.
// So OFFSET model: x_mask ≈ x_game + 164, y_mask ≈ y_game + 282.
// But that means scale = 1 and there's just a fixed offset. Plausible
// if the mask covers a larger area than the game tile grid (which we
// know is ~244-ish wide, 152-ish tall, and the mask is 1020x700).
//
// Test scale-1 + offset: dx = 164, dy = 282?
// Check: 335-171=164, 380.7-99=281.7 → dx≈164, dy≈282. That's a
// fixed pixel offset, no scaling. Suspicious. Let me re-check.
//
// dig-tile-trail used scale 1020/244=4.18 px/tile. Roma is at game
// tile ~80,32 → pixel 334,~134. Hmm.
//
// Better approach: compute distance using mask coords directly. The
// ship moved 1 tile west, 7 tiles south in game tiles. In mask coords:
// (172,92)→(171,99) at scale 2x,4x: 344→342 (Δ=2) X, 368→396 (Δ=28).
// The CHANGED bbox is 16 wide × 14 tall. So the halo radius is ~7
// tiles in game coords. 7 tiles × 2 = 14 px-X (matches bbox width 16!),
// 7 tiles × 4 = 28 px-Y (doesn't match bbox height 14).
//
// So either the halo is non-isotropic in mask coords, OR the mask has
// equal scale in X and Y. If the halo is isotropic and bbox is 16×14
// then the X- and Y-scales are similar (~2x). At 2x scale ship-B is
// at (342, 198) — doesn't fit centroid (335,381).
//
// Let me look at it differently. Empirically:
//   centroid (335, 381), ship at game (171, 99).
//   bbox 16×14.
// The halo radius (in mask coords) is ~8. If we set ship_mask = (335,381)
// directly (ignoring game→mask transform) and compute distance from THAT
// point to each changed cell, we should get a tight gradient.
//
// THAT is testable WITHOUT knowing the game→mask transform. Just use
// the ship's NEW position in mask coords ≈ centroid of B's halo.

console.log(`\n--- Quick test: distance from centroid to each cell ---`);
function testFormulaUsingCentroid(centroid, name, fn, useVA = false) {
  let sumX = 0, sumY = 0, n = 0;
  for (const c of changed) {
    sumX += (useVA ? c.va : c.vb) * 0 + 1; // just to count
    n++;
  }
  const predicted = changed.map(c => fn(c.x - centroid[0], c.y - centroid[1]));
  const observed = changed.map(c => useVA ? c.va : c.vb);
  // Linear best fit: observed = a*predicted + b, compute R^2
  const meanO = observed.reduce((a, b) => a + b, 0) / observed.length;
  const meanP = predicted.reduce((a, b) => a + b, 0) / predicted.length;
  let num = 0, denO = 0, denP = 0;
  for (let i = 0; i < observed.length; i++) {
    num += (predicted[i] - meanP) * (observed[i] - meanO);
    denO += (observed[i] - meanO) ** 2;
    denP += (predicted[i] - meanP) ** 2;
  }
  const r = denO * denP > 0 ? num / Math.sqrt(denO * denP) : 0;
  console.log(`  ${name.padEnd(40)}  r=${r.toFixed(3)}  r²=${(r * r).toFixed(3)}`);
  return r * r;
}

// Try centroid-based with multiple metrics
const ctr = [cx, cy];
testFormulaUsingCentroid(ctr, "chebyshev",       (dx, dy) => Math.max(Math.abs(dx), Math.abs(dy)));
testFormulaUsingCentroid(ctr, "manhattan",       (dx, dy) => Math.abs(dx) + Math.abs(dy));
testFormulaUsingCentroid(ctr, "euclidean",       (dx, dy) => Math.sqrt(dx * dx + dy * dy));
testFormulaUsingCentroid(ctr, "chebyshev (vA, old centroid?)", (dx, dy) => Math.max(Math.abs(dx), Math.abs(dy)), true);
