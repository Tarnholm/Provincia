// dig-mask-halo4.js — Attempt 3 (continuing after attempt 3 errored).
// Ship uuid not found in save_6 — uuids likely change. Find ship by:
//  - Most likely: type-4 in save_6 that is geographically near (333,380)
//    OR a NEW type-4 uuid not in save_5.

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);

function findAllMagic(buf, hint = 0) {
  const o = [];
  let p = hint;
  while (true) { const i = buf.indexOf(MAGIC, p); if (i < 0) break; o.push(i); p = i + 4; }
  return o;
}
function decodeRle(buf, start, end, W = 1020, H = 700) {
  const mask = new Uint8Array(W * H);
  let cursor = 0;
  let p = start;
  while (p < end - 1 && cursor < mask.length) {
    const v = buf[p]; const c = buf[p + 1];
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

// Find type-4 positions present in save_5 but absent in save_6, by exact uuid:
const navalA = posA.filter(p => p.type === 4);
const navalB = posB.filter(p => p.type === 4);
const naUuidA = new Set(navalA.map(p => p.uuid));
const naUuidB = new Set(navalB.map(p => p.uuid));
const goneA = navalA.filter(p => !naUuidB.has(p.uuid));
const newB = navalB.filter(p => !naUuidA.has(p.uuid));
console.log(`Type-4 in save_5: ${navalA.length}, save_6: ${navalB.length}`);
console.log(`Type-4 in A but not B: ${goneA.length}`);
for (const p of goneA.slice(0, 5)) console.log(`  uuid=0x${p.uuid.toString(16)} (${p.x},${p.y})`);
console.log(`Type-4 in B but not A: ${newB.length}`);
for (const p of newB.slice(0, 5)) console.log(`  uuid=0x${p.uuid.toString(16)} (${p.x},${p.y})`);

// If there's 1 in each: that's the moved ship.
// We expected ship at game(172,92)→(171,99) but save_5 has (333,380).
// Let's find what position in save_6 most likely IS the moved ship.
// Constraint: must be near (333,380) AND not in save_5's type-4 set.
if (newB.length > 0) {
  console.log(`\nNew-in-B type-4 positions sorted by distance from save_5 ship (333,380):`);
  const sorted = newB.map(p => ({
    ...p,
    d: Math.max(Math.abs(p.x - 333), Math.abs(p.y - 380)),
  })).sort((a, b) => a.d - b.d);
  for (const p of sorted.slice(0, 10)) {
    console.log(`  (${p.x},${p.y}) d=${p.d} uuid=0x${p.uuid.toString(16)}`);
  }
}

// Same for gone-in-A — the ship's OLD position.
if (goneA.length > 0) {
  console.log(`\nGone-from-A type-4 positions (these MOVED away):`);
  for (const p of goneA.slice(0, 20)) console.log(`  (${p.x},${p.y}) uuid=0x${p.uuid.toString(16)}`);
}

// === All B positions within 25 of changed-cell bbox ===
function uniqueMap(positions) {
  const m = new Map();
  for (const p of positions) {
    if (!m.has(p.uuid)) m.set(p.uuid, p);
    else { const ex = m.get(p.uuid); if (p.type > ex.type) m.set(p.uuid, p); }
  }
  return m;
}
const mapA = uniqueMap(posA);
const mapB = uniqueMap(posB);

// Get all B positions within cheb=25 of bbox.
const cells = changed;
const bx0 = Math.min(...cells.map(c => c.x)), bx1 = Math.max(...cells.map(c => c.x));
const by0 = Math.min(...cells.map(c => c.y)), by1 = Math.max(...cells.map(c => c.y));

function nearBboxB(pos, maxD = 25) {
  // Distance from pos to the bbox (chebyshev)
  const dx = Math.max(0, pos.x < bx0 ? bx0 - pos.x : pos.x > bx1 ? pos.x - bx1 : 0);
  const dy = Math.max(0, pos.y < by0 ? by0 - pos.y : pos.y > by1 ? pos.y - by1 : 0);
  return Math.max(dx, dy) <= maxD;
}
const nearAllB = [...mapB.values()].filter(p => nearBboxB(p, 25));
console.log(`\nB-side positions within chebyshev=25 of bbox: ${nearAllB.length}`);
for (const p of nearAllB.slice(0, 30)) {
  console.log(`  type=${p.type} (${p.x},${p.y}) uuid=0x${p.uuid.toString(16)}`);
}

const nearAllA = [...mapA.values()].filter(p => nearBboxB(p, 25));
console.log(`\nA-side positions within chebyshev=25 of bbox: ${nearAllA.length}`);

// Are these the SAME positions (same coords)? If so, only the ship moved.
function sortedKey(p) { return `${p.x},${p.y}`; }
const ka = new Set(nearAllA.map(sortedKey));
const kb = new Set(nearAllB.map(sortedKey));
console.log(`In A only (gone from B): ${nearAllA.filter(p => !kb.has(sortedKey(p))).map(p => `(${p.x},${p.y})`).join(", ")}`);
console.log(`In B only (new in B):    ${nearAllB.filter(p => !ka.has(sortedKey(p))).map(p => `(${p.x},${p.y})`).join(", ")}`);

// ============ The actual fit ============
// Use ALL B-side positions within radius 25 of bbox as candidate sources.
// Halo at cell c = max over Roman positions of max(0, K - dist).
// Since faction labels unknown: treat ALL these as Roman first (most are
// likely Romans clustered in Italy).

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
  console.log(`  ${label.padEnd(60)} r=${r.toFixed(3)} r²=${(r*r).toFixed(3)}`);
  return r * r;
}

const vb = cells.map(c => c.vb);
const va = cells.map(c => c.va);

console.log(`\n--- Multi-source: ${nearAllB.length} sources from B-side, MAX hypothesis ---`);
for (const K of [7, 8, 9, 10, 11, 12]) {
  for (const metric of ["cheb", "man", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                 : metric === "man"  ? (c, s) => Math.abs(c.x - s.x) + Math.abs(c.y - s.y)
                 :                     (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = cells.map(c => {
      let best = 0;
      for (const s of nearAllB) {
        const d = distFn(c, s);
        const v = Math.max(0, K - Math.floor(d));
        if (v > best) best = v;
      }
      return best;
    });
    correlate(pred, vb, `B-srcs K=${K} ${metric} max → vb`);
  }
}

console.log(`\n--- Comparing A-side prediction → va ---`);
for (const K of [7, 8, 9, 10, 11, 12]) {
  for (const metric of ["cheb", "man", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                 : metric === "man"  ? (c, s) => Math.abs(c.x - s.x) + Math.abs(c.y - s.y)
                 :                     (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = cells.map(c => {
      let best = 0;
      for (const s of nearAllA) {
        const d = distFn(c, s);
        const v = Math.max(0, K - Math.floor(d));
        if (v > best) best = v;
      }
      return best;
    });
    correlate(pred, va, `A-srcs K=${K} ${metric} max → va`);
  }
}

// ===== Visualize best prediction vs vb in bbox =====
function findBest(srcs, observed, label) {
  let best = { r2: -1 };
  for (const K of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    for (const metric of ["cheb", "man", "euc"]) {
      const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                   : metric === "man"  ? (c, s) => Math.abs(c.x - s.x) + Math.abs(c.y - s.y)
                   :                     (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
      const pred = cells.map(c => {
        let bestv = 0;
        for (const s of srcs) {
          const d = distFn(c, s);
          const v = Math.max(0, K - Math.floor(d));
          if (v > bestv) bestv = v;
        }
        return bestv;
      });
      const n = pred.length;
      const mP = pred.reduce((a, b) => a + b, 0) / n;
      const mO = observed.reduce((a, b) => a + b, 0) / n;
      let num = 0, dP = 0, dO = 0;
      for (let i = 0; i < n; i++) {
        num += (pred[i] - mP) * (observed[i] - mO);
        dP += (pred[i] - mP) ** 2;
        dO += (observed[i] - mO) ** 2;
      }
      const r = dP * dO > 0 ? num / Math.sqrt(dP * dO) : 0;
      const r2 = r * r;
      if (r2 > best.r2) best = { r2, K, metric, pred };
    }
  }
  console.log(`\nBEST ${label}: K=${best.K} ${best.metric} r²=${best.r2.toFixed(3)}`);
  // Show grid
  const predMap = new Map();
  for (let i = 0; i < cells.length; i++) predMap.set(`${cells[i].x},${cells[i].y}`, best.pred[i]);
  console.log(`PRED                                                OBSERVED`);
  for (let y = by0; y <= by1; y++) {
    let pr = "", ob = "";
    for (let x = bx0; x <= bx1; x++) {
      const p = predMap.get(`${x},${y}`);
      const c = cells.find(cc => cc.x === x && cc.y === y);
      pr += p === undefined ? " ." : String(p).padStart(2, " ");
      ob += c ? String(observed[cells.indexOf(c)]).padStart(2, " ") : "  ";
    }
    console.log(`  ${pr}    ${ob}`);
  }
}

findBest(nearAllB, vb, "B-sources → vb");
findBest(nearAllA, va, "A-sources → va");
