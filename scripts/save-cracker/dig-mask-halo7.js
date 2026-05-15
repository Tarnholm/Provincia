// dig-mask-halo7.js — Final iteration. Observed values are capped 0..9.
// Predicted SUM goes 0..50ish. Need a saturation/transform.

const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const MAGIC = Buffer.from([0xf0, 0x0a, 0xaf, 0xf0]);
function findAllMagic(buf, hint = 0) {
  const o = []; let p = hint;
  while (true) { const i = buf.indexOf(MAGIC, p); if (i < 0) break; o.push(i); p = i + 4; }
  return o;
}
function decodeRle(buf, start, end, W = 1020, H = 700) {
  const mask = new Uint8Array(W * H);
  let cursor = 0; let p = start;
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

const posB = collectPositions(bufB);
function uniqueMap(positions) {
  const m = new Map();
  for (const p of positions) {
    if (!m.has(p.uuid)) m.set(p.uuid, p);
    else { const ex = m.get(p.uuid); if (p.type > ex.type) m.set(p.uuid, p); }
  }
  return m;
}
const allB = [...uniqueMap(posB).values()];

function correlate(p, o) {
  const n = p.length;
  const mP = p.reduce((a, b) => a + b, 0) / n;
  const mO = o.reduce((a, b) => a + b, 0) / n;
  let num = 0, dP = 0, dO = 0;
  for (let i = 0; i < n; i++) {
    num += (p[i] - mP) * (o[i] - mO);
    dP += (p[i] - mP) ** 2;
    dO += (o[i] - mO) ** 2;
  }
  return dP * dO > 0 ? num / Math.sqrt(dP * dO) : 0;
}
const vb = changed.map(c => c.vb);

// Use the best metric & K from before: cheb K=11.
const distFn = (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y));

function predSum(K, allBSrcs) {
  return changed.map(c => {
    let s2 = 0;
    for (const s of allBSrcs) s2 += Math.max(0, K - distFn(c, s));
    return s2;
  });
}

// Try clipping/saturating the SUM, and FILTERING out far positions
// (since most are non-Roman and shouldn't contribute).

// Filter: only positions within radius R of bbox of changed cells.
const bx0 = Math.min(...changed.map(c => c.x)), bx1 = Math.max(...changed.map(c => c.x));
const by0 = Math.min(...changed.map(c => c.y)), by1 = Math.max(...changed.map(c => c.y));
function nearBbox(p, maxD) {
  const dx = Math.max(0, p.x < bx0 ? bx0 - p.x : p.x > bx1 ? p.x - bx1 : 0);
  const dy = Math.max(0, p.y < by0 ? by0 - p.y : p.y > by1 ? p.y - by1 : 0);
  return Math.max(dx, dy) <= maxD;
}
const filtRadii = [10, 15, 20, 25, 30, 40, 50, 75];
for (const R of filtRadii) {
  const subset = allB.filter(p => nearBbox(p, R));
  for (const K of [8, 10, 11, 12, 14]) {
    const pred = predSum(K, subset);
    const r = correlate(pred, vb);
    if (r * r > 0.6) console.log(`  R≤${R} (${subset.length} srcs), K=${K}: r²=${(r*r).toFixed(3)}`);
  }
}

// Test: value = floor(c1 * SUM + c2), see if there's a saturating non-linearity
console.log(`\nTry MIN-cap on SUM (saturation):`);
let bestSat = { r2: -1 };
for (const R of [10, 15, 20, 25, 40]) {
  const subset = allB.filter(p => nearBbox(p, R));
  for (const K of [5, 7, 8, 9, 10, 11, 12]) {
    const pred = predSum(K, subset);
    for (const cap of [5, 6, 7, 8, 9, 10, 12, 15]) {
      for (const scale of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1.0]) {
        const tx = pred.map(v => Math.min(cap, Math.floor(v * scale)));
        const r = correlate(tx, vb);
        const r2 = r * r;
        if (r2 > bestSat.r2) bestSat = { r2, K, R, cap, scale, pred: tx };
      }
    }
  }
}
console.log(`Best saturating fit: R≤${bestSat.R} K=${bestSat.K} cap=${bestSat.cap} scale=${bestSat.scale} r²=${bestSat.r2.toFixed(3)}`);

// Maybe: simpler — value = max(0, K - min_dist_to_settlement)
// Settlements have own coords; use settlement positions instead of characters.
// Settlement positions: u32 at +341 / +345 inside settlement records.
// Quick scan: find pairs (u32 X, u32 Y) at offset+341/+345 that look like
// settlements (Y at X+4 stride 4). RIS imperial has ~120 settlements.
console.log(`\nQuick settlement scan: looking for plausible (X,Y) pairs at u32 spacing in body root:`);
function scanSettlementPositions(buf) {
  // Settlement records have (X,Y) pairs of u32. Approach: search for u32
  // followed by u32 where both are in (50..1000, 50..600) ranges, plus
  // some structural signature.
  const candidates = [];
  for (let i = 0x4000; i < 0x1f00000 - 8; i += 4) {
    const x = buf.readUInt32LE(i);
    if (x < 50 || x > 1020) continue;
    const y = buf.readUInt32LE(i + 4);
    if (y < 50 || y > 700) continue;
    candidates.push({ off: i, x, y });
  }
  return candidates;
}
// Way too many. Skip — focus on character positions.

// === Better hypothesis: The mask encodes turns/moves-from-nearest-character ===
// A character with movement points has a 'movement range' that fans out
// from their position. The mask might be (max_move - moves_to_reach_cell).
// For type-6/type-5/type-4 records, movement points might be ~10. With
// 1-pixel-per-tile movement (which matches map_regions space).
//
// In that interpretation, the mask = MOVE_COST_CHEAPEST_PATH from any
// friendly. Value v means "this cell is reachable in (K - v) move points
// by some friendly".
//
// Without terrain costs, that's just Chebyshev distance with K cap.
// Already tested → r²=0.43 max.
//
// What if it's MAX over sources of (max_move - cheb_dist)? Same as MAX
// hypothesis. r²=0.43.
//
// The SUM (r²=0.68) suggests OVERLAP — multiple friendlies "stack"
// influence. Like an AI strategic-importance heatmap.

// === Try a sharply non-linear transform: value = floor(sqrt(SUM)) ===
console.log(`\nTry sqrt/log transform of SUM:`);
for (const R of [10, 15, 20, 30]) {
  const subset = allB.filter(p => nearBbox(p, R));
  for (const K of [5, 7, 10, 12, 15]) {
    const sum = predSum(K, subset);
    const preds = [
      ["sqrt", sum.map(v => Math.floor(Math.sqrt(v)))],
      ["log2", sum.map(v => v > 0 ? Math.floor(Math.log2(v + 1)) : 0)],
      ["÷7",   sum.map(v => Math.floor(v / 7))],
    ];
    for (const [name, p] of preds) {
      const r = correlate(p, vb);
      if (r * r > 0.65) console.log(`  R≤${R} K=${K} ${name}: r²=${(r*r).toFixed(3)}`);
    }
  }
}

// === Show best SAT prediction grid ===
console.log(`\nGrid: best saturating prediction R≤${bestSat.R} K=${bestSat.K} cap=${bestSat.cap} scale=${bestSat.scale}`);
const predMap = new Map();
for (let i = 0; i < changed.length; i++) predMap.set(`${changed[i].x},${changed[i].y}`, bestSat.pred[i]);
for (let y = by0; y <= by1; y++) {
  let pr = "", ob = "";
  for (let x = bx0; x <= bx1; x++) {
    const p = predMap.get(`${x},${y}`);
    const c = changed.find(cc => cc.x === x && cc.y === y);
    pr += p === undefined ? "  ." : p.toString().padStart(3, " ");
    ob += c ? c.vb.toString().padStart(3, " ") : "   ";
  }
  console.log(`  ${pr}     ${ob}`);
}
