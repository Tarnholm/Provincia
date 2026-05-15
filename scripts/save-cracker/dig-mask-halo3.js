// dig-mask-halo3.js — Session 42 attempt 3.
// Key insight: world-object (x,y) coords ARE in mask-pixel space (1020x700)
// directly. The "(172,92)→(171,99)" in the brief was a different coord
// system. The ship in save_5 is at game(333,380) (type-4, naval).
//
// Plan:
//   1) Find ship in save_5 (uuid → (x,y)_A) and save_6 ((x,y)_B).
//   2) Roman positions = positions WHOSE (x,y) hasn't moved between A
//      and B (Romans not under player control didn't move?) — actually
//      the only thing that changed is rec 0 mask, so the ONLY moving
//      thing should be the ship.
//   3) Hypothesis: faction-0's halo is the MAX over all Roman char/army
//      positions of (K - dist_from_pos). Distance is Chebyshev / Euclid.
//   4) But we don't know which positions are Roman! However:
//      - If a position is Roman, it's NEAR Italy/Rome (game x~330, y~370-400).
//      - More robust: extract all positions whose presence affects rec-0.
//        The CHANGED bbox is centered on the ship. So nearby positions
//        whose halos overlap the bbox might also be Roman.
//
//   Simplest test: use a SINGLE source (the ship at its new position),
//   and test K - chebyshev_distance, where K = max value seen in B (=8).

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

const posA = collectPositions(bufA);
const posB = collectPositions(bufB);

// Find ship: type-4 at game (333,380) in save_5.
const shipA = posA.find(p => p.type === 4 && p.x === 333 && p.y === 380);
console.log(`Ship in save_5 at (333,380): uuid=0x${shipA?.uuid.toString(16)} off=0x${shipA?.off.toString(16)}`);
// Same uuid in save_6?
const shipB = posB.find(p => p.type === 4 && p.uuid === shipA.uuid);
console.log(`Ship in save_6 by uuid: ${shipB ? `(${shipB.x},${shipB.y})` : "NOT FOUND"}`);

// If the ship MOVED, where is the new position?
// Build uuid → unique pos map (type-6 wins on duplicate uuids).
function uniqueMap(positions) {
  const m = new Map();
  for (const p of positions) {
    if (!m.has(p.uuid)) m.set(p.uuid, p);
    else {
      const ex = m.get(p.uuid);
      if (p.type > ex.type) m.set(p.uuid, p); // prefer type-6 > 5 > 4
    }
  }
  return m;
}
const mapA = uniqueMap(posA);
const mapB = uniqueMap(posB);
const shipA2 = mapA.get(shipA.uuid);
const shipB2 = mapB.get(shipA.uuid);
console.log(`Ship in save_5 (unique map): (${shipA2?.x},${shipA2?.y}) type=${shipA2?.type}`);
console.log(`Ship in save_6 (unique map): (${shipB2?.x},${shipB2?.y}) type=${shipB2?.type}`);

// What positions are NEAR the changed bbox? Those candidates whose
// distance from any changed cell is < 30:
const inRange = [];
for (const [uuid, p] of mapA) {
  let minD = Infinity;
  for (const c of changed) {
    const d = Math.max(Math.abs(p.x - c.x), Math.abs(p.y - c.y));
    if (d < minD) minD = d;
  }
  if (minD < 20) inRange.push({ ...p, minD });
}
inRange.sort((a, b) => a.minD - b.minD);
console.log(`\nPositions within chebyshev=20 of any changed cell: ${inRange.length}`);
for (const p of inRange.slice(0, 20)) {
  console.log(`  type=${p.type} (${p.x},${p.y}) minD=${p.minD} uuid=0x${p.uuid.toString(16)}`);
}

// ===== Core test: K - chebyshev(cell, ship_B) =====
// First, ship's new position is reflected in save_6 mask. Use mapB
// position as source.
const srcA = shipA2; // old ship
const srcB = shipB2; // new ship

function correlate(predict, observe, label) {
  const n = predict.length;
  const mP = predict.reduce((a, b) => a + b, 0) / n;
  const mO = observe.reduce((a, b) => a + b, 0) / n;
  let num = 0, dP = 0, dO = 0;
  for (let i = 0; i < n; i++) {
    num += (predict[i] - mP) * (observe[i] - mO);
    dP += (predict[i] - mP) ** 2;
    dO += (observe[i] - mO) ** 2;
  }
  const r = dP * dO > 0 ? num / Math.sqrt(dP * dO) : 0;
  console.log(`  ${label.padEnd(50)} r=${r.toFixed(3)} r²=${(r*r).toFixed(3)}`);
  return r * r;
}

console.log(`\n--- Single-source hypothesis: mask = max(0, K - dist(cell, ship_B)) ---`);
const cells = changed.map(c => ({ x: c.x, y: c.y, vb: c.vb, va: c.va }));
const vb = cells.map(c => c.vb);

for (const K of [7, 8, 9, 10]) {
  const predCheb = cells.map(c => Math.max(0, K - Math.max(Math.abs(c.x - srcB.x), Math.abs(c.y - srcB.y))));
  correlate(predCheb, vb, `K=${K}, chebyshev`);
}
for (const K of [10, 12, 14, 16, 18]) {
  const predMan = cells.map(c => Math.max(0, K - (Math.abs(c.x - srcB.x) + Math.abs(c.y - srcB.y))));
  correlate(predMan, vb, `K=${K}, manhattan`);
}
for (const K of [8, 10, 12, 14, 16]) {
  const predEuc = cells.map(c => Math.max(0, Math.floor(K - Math.sqrt((c.x - srcB.x) ** 2 + (c.y - srcB.y) ** 2))));
  correlate(predEuc, vb, `K=${K}, euclidean (floor)`);
}

// ===== Multi-source hypothesis =====
// Now use ALL nearby positions (those within 20 of bbox) as sources.
// Halo value = max over sources of max(0, K - dist(cell, src)).
console.log(`\n--- Multi-source (in-range) hypothesis: mask = max_i max(0, K - dist(cell, src_i)) ---`);
const srcs = inRange.map(p => mapB.get(p.uuid) || p); // use B positions where possible
console.log(`  num sources: ${srcs.length}`);

for (const K of [7, 8, 9, 10]) {
  const pred = cells.map(c => {
    let best = 0;
    for (const s of srcs) {
      const d = Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y));
      const v = Math.max(0, K - d);
      if (v > best) best = v;
    }
    return best;
  });
  correlate(pred, vb, `multi, K=${K}, chebyshev max`);
}

// ===== Check the predicted vs observed for the best K =====
function showGrid(name, fn) {
  const bx0 = Math.min(...cells.map(c => c.x)), bx1 = Math.max(...cells.map(c => c.x));
  const by0 = Math.min(...cells.map(c => c.y)), by1 = Math.max(...cells.map(c => c.y));
  console.log(`\n  ${name}: predicted vs vb in bbox X=[${bx0}..${bx1}] Y=[${by0}..${by1}]`);
  console.log(`  PREDICTED:                              OBSERVED:`);
  for (let y = by0; y <= by1; y++) {
    let predRow = "", obsRow = "";
    for (let x = bx0; x <= bx1; x++) {
      const c = cells.find(c => c.x === x && c.y === y);
      const p = fn(x, y);
      predRow += String(p).padStart(2, " ");
      obsRow += c ? String(c.vb).padStart(2, " ") : "  ";
    }
    console.log(`  ${predRow}    ${obsRow}`);
  }
}

// Show prediction for best chebyshev K
showGrid("multi chebyshev K=8", (x, y) => {
  let best = 0;
  for (const s of srcs) {
    const d = Math.max(Math.abs(x - s.x), Math.abs(y - s.y));
    const v = Math.max(0, 8 - d);
    if (v > best) best = v;
  }
  return best;
});

// ===== Save full state for next attempt if needed =====
fs.writeFileSync(path.join(__dirname, "out-mask-halo-srcs.json"), JSON.stringify(srcs, null, 2));
