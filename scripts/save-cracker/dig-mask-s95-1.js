// dig-mask-s95-1.js — Session 95 attempt 1.
// Hypothesis: session 42's r²=0.70 fit can be lifted past 0.95 by
// weighting each per-source contribution by TERRAIN at that cell.
//
// Per RTW Aerial-map convention: forest attenuates visibility/movement;
// mountains may block influence. Use map_ground_types_large.tga.
//
// Method:
//   1) Recompute changed cells from save_5.2 → save_6.2.
//   2) Collect all type-6/5/4 (x,y) positions in save_6 (B-side).
//   3) For each cell, compute pred = SUM_i max(0, K - cheb_dist(cell, i)) * W(terrain(cell))
//      where W = {plains:1.0, forest:0.7, mountain:0.0, other:0.85}.
//   4) Try BOTH:
//      (a) weight the CELL  (modulate final value)
//      (b) weight along the RAY (each tile traversed attenuates)
//   5) Cap & scale per session 42 (cap=8, scale=0.20).
//   6) Sweep K to confirm K=11 is still optimal w/ terrain.

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
console.log(`Changed cells: ${changed.length}`);
const bx0 = Math.min(...changed.map(c => c.x)), bx1 = Math.max(...changed.map(c => c.x));
const by0 = Math.min(...changed.map(c => c.y)), by1 = Math.max(...changed.map(c => c.y));
console.log(`bbox X[${bx0}..${bx1}] Y[${by0}..${by1}]`);

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
console.log(`All B positions: ${allB.length}`);

// --- Load terrain TGA ---
const TGA_PATH = "C:/dev/Provincia/public/map_ground_types_large.tga";
const tga = fs.readFileSync(TGA_PATH);
const TW = tga.readUInt16LE(12);
const TH = tga.readUInt16LE(14);
const TPD = tga[16] / 8;          // bytes per pixel (3 for 24-bit)
const TIMG_OFF = 18 + tga[0];
const TIMG_DESC = tga[17];
const TGA_TOP_DOWN = (TIMG_DESC & 0x20) !== 0;
console.log(`Terrain TGA: ${TW}x${TH} depth=${tga[16]} topDown=${TGA_TOP_DOWN}`);
// Per RTW convention TGA may be bottom-up (origin lower-left) when bit5=0.

// Map mask coords (1020x700) → terrain coords (2041x1401).
// Scale ≈ 2x in each axis. Sample directly.
const SX = TW / W;
const SY = TH / H;
function terrainColorAt(mx, my) {
  let tx = Math.min(TW - 1, Math.floor(mx * SX));
  let ty = Math.min(TH - 1, Math.floor(my * SY));
  // TGA may be stored bottom-up. The repo's App.js samples directly without
  // flipping; trust that convention.
  if (!TGA_TOP_DOWN) ty = TH - 1 - ty;
  const off = TIMG_OFF + (ty * TW + tx) * TPD;
  return [tga[off + 2], tga[off + 1], tga[off]]; // BGR → RGB
}

// Per the repo's GROUND_TYPE_PALETTE (src/App.js):
//   "0,0,0"      Plains
//   "64,0,0"     Fertile lowland
//   "196,0,0"    Highland
//   "0,128,128"  Mountain
//   "101,124,0"  Shrubland
//   "0,128,0"    Forest
//   "128,128,64" Sand desert
//   "128,0,0"    Rocky
//   "98,65,65"   Rocky desert
//   "0,64,0"     Dense forest
//   "196,128,128" Open scrub
//   "0,255,128"  Swamp
//   "96,160,64"  Light forest
//   "255,255,255" Impassable
const TERRAIN_WEIGHT = {
  "0,0,0":         1.00,  // Plains
  "64,0,0":        1.00,  // Fertile lowland
  "196,0,0":       0.85,  // Highland
  "0,128,128":     0.00,  // Mountain — BLOCKS
  "101,124,0":     0.85,  // Shrubland
  "0,128,0":       0.70,  // Forest
  "128,128,64":    0.85,  // Sand desert
  "128,0,0":       0.85,  // Rocky
  "98,65,65":      0.85,  // Rocky desert
  "0,64,0":        0.70,  // Dense forest
  "196,128,128":   0.85,  // Open scrub
  "0,255,128":     0.85,  // Swamp
  "96,160,64":     0.70,  // Light forest
  "255,255,255":   0.00,  // Impassable — BLOCKS
};

function weightAt(mx, my) {
  const [r, g, b] = terrainColorAt(mx, my);
  const k = `${r},${g},${b}`;
  const w = TERRAIN_WEIGHT[k];
  return w === undefined ? 0.85 : w;
}

// Dump terrain present in the bbox so we know there's variation to model.
const terCounts = new Map();
for (const c of changed) {
  const [r, g, b] = terrainColorAt(c.x, c.y);
  const k = `${r},${g},${b}`;
  terCounts.set(k, (terCounts.get(k) || 0) + 1);
}
console.log(`\nTerrain colors in changed-cell bbox:`);
for (const [k, n] of [...terCounts.entries()].sort((a, b) => b[1] - a[1])) {
  const w = TERRAIN_WEIGHT[k];
  console.log(`  (${k}): ${n} cells   weight=${w === undefined ? "?(0.85)" : w}`);
}

function correlate(predict, observe) {
  const n = predict.length;
  const mP = predict.reduce((a, b) => a + b, 0) / n;
  const mO = observe.reduce((a, b) => a + b, 0) / n;
  let num = 0, dP = 0, dO = 0;
  for (let i = 0; i < n; i++) {
    num += (predict[i] - mP) * (observe[i] - mO);
    dP += (predict[i] - mP) ** 2;
    dO += (observe[i] - mO) ** 2;
  }
  return dP * dO > 0 ? num / Math.sqrt(dP * dO) : 0;
}
const vb = changed.map(c => c.vb);
const cheb = (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y));

// --- Baseline: session 42 formula, no terrain ---
function baselinePred(K) {
  return changed.map(c => {
    let s = 0;
    for (const src of allB) s += Math.max(0, K - cheb(c, src));
    return s;
  });
}
const baselineRaw = baselinePred(11);
const rBase = correlate(baselineRaw, vb);
console.log(`\nBaseline (no terrain): SUM K=11 cheb → vb  r²=${(rBase * rBase).toFixed(3)}`);

// Saturated baseline matching session 42 final
const baselineSat = baselineRaw.map(v => Math.min(8, Math.floor(0.20 * v)));
const rBaseSat = correlate(baselineSat, vb);
console.log(`Baseline saturated (cap=8, scale=0.20): r²=${(rBaseSat * rBaseSat).toFixed(3)}`);

// --- Hypothesis 1: weight the CELL (final-value modulation) ---
console.log(`\n=== H1: cell-terrain modulation: pred = sum_i max(0, K - d(c, i)) * W(c) ===`);
let bestH1 = { r2: -1 };
for (const K of [8, 10, 11, 12, 13, 14]) {
  const raw = baselinePred(K);
  for (const cap of [6, 7, 8, 9, 10, 12, 15]) {
    for (const scale of [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]) {
      // Both pre- and post-cap weighting (try post-cap so cap is observed)
      const pred = raw.map((v, i) => {
        const c = changed[i];
        const w = weightAt(c.x, c.y);
        return Math.min(cap, Math.floor(v * scale * w));
      });
      const r = correlate(pred, vb);
      const r2 = r * r;
      if (r2 > bestH1.r2) bestH1 = { r2, K, cap, scale, pred };
    }
  }
}
console.log(`H1 best: K=${bestH1.K} cap=${bestH1.cap} scale=${bestH1.scale} r²=${bestH1.r2.toFixed(3)}`);

// --- Hypothesis 2: weight the SOURCE BY TERRAIN AT SOURCE ---
console.log(`\n=== H2: source-terrain modulation: pred = sum_i W(src_i) * max(0, K - d(c, i)) ===`);
let bestH2 = { r2: -1 };
for (const K of [8, 10, 11, 12, 13, 14]) {
  const raw = changed.map(c => {
    let s = 0;
    for (const src of allB) {
      const w = weightAt(src.x, src.y);
      s += w * Math.max(0, K - cheb(c, src));
    }
    return s;
  });
  for (const cap of [6, 7, 8, 9, 10, 12, 15]) {
    for (const scale of [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]) {
      const pred = raw.map(v => Math.min(cap, Math.floor(v * scale)));
      const r = correlate(pred, vb);
      const r2 = r * r;
      if (r2 > bestH2.r2) bestH2 = { r2, K, cap, scale, pred };
    }
  }
}
console.log(`H2 best: K=${bestH2.K} cap=${bestH2.cap} scale=${bestH2.scale} r²=${bestH2.r2.toFixed(3)}`);

// --- Hypothesis 3: RAY-ATTENUATED, per-source contribution attenuated by
//     the minimum weight along the line between src and cell ---
function rayAttenuate(c, s) {
  const steps = Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y));
  if (steps <= 1) return 1.0;
  let prod = 1.0;
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const x = Math.round(s.x + (c.x - s.x) * t);
    const y = Math.round(s.y + (c.y - s.y) * t);
    const w = weightAt(x, y);
    if (w === 0) return 0;
    prod *= w;
  }
  return prod;
}
console.log(`\n=== H3: ray-attenuated SUM (min weight along ray blocks) ===`);
let bestH3 = { r2: -1 };
for (const K of [10, 11, 12, 14, 16]) {
  const raw = changed.map(c => {
    let s = 0;
    for (const src of allB) {
      const d = cheb(c, src);
      if (d >= K) continue;
      const att = rayAttenuate(c, src);
      s += att * (K - d);
    }
    return s;
  });
  for (const cap of [6, 7, 8, 9, 10, 12, 15]) {
    for (const scale of [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]) {
      const pred = raw.map(v => Math.min(cap, Math.floor(v * scale)));
      const r = correlate(pred, vb);
      const r2 = r * r;
      if (r2 > bestH3.r2) bestH3 = { r2, K, cap, scale, pred };
    }
  }
}
console.log(`H3 best: K=${bestH3.K} cap=${bestH3.cap} scale=${bestH3.scale} r²=${bestH3.r2.toFixed(3)}`);

// --- Hypothesis 4: Multi-tier weights swept (find optimal weight per terrain) ---
console.log(`\n=== H4: brute-force optimal weight for the 4 main terrains in bbox ===`);
// Group changed cells by terrain key; we can solve per-terrain weight via
// linear regression vs vb / raw_baseline (only meaningful if baseline > 0).
const baseRaw11 = baselinePred(11);
const byTerrain = new Map();
for (let i = 0; i < changed.length; i++) {
  const c = changed[i];
  const [r, g, b] = terrainColorAt(c.x, c.y);
  const k = `${r},${g},${b}`;
  if (!byTerrain.has(k)) byTerrain.set(k, []);
  byTerrain.get(k).push({ raw: baseRaw11[i], obs: c.vb });
}
console.log(`Per-terrain best linear scale (predict obs = s * raw):`);
const tWeights = {};
for (const [k, arr] of byTerrain) {
  let num = 0, den = 0;
  for (const { raw, obs } of arr) { num += raw * obs; den += raw * raw; }
  const s = den > 0 ? num / den : 0;
  tWeights[k] = s;
  console.log(`  (${k}) n=${arr.length} optimal_scale=${s.toFixed(4)}`);
}
// Apply per-terrain scale and re-correlate
const predH4 = changed.map((c, i) => {
  const [r, g, b] = terrainColorAt(c.x, c.y);
  const k = `${r},${g},${b}`;
  return Math.min(8, Math.floor(baseRaw11[i] * (tWeights[k] || 0)));
});
const rH4 = correlate(predH4, vb);
console.log(`H4 per-terrain optimized r²=${(rH4 * rH4).toFixed(3)}`);

// --- Summary ---
console.log(`\n=== SUMMARY ===`);
console.log(`Baseline (no terrain, sat):    r²=${(rBaseSat * rBaseSat).toFixed(3)}`);
console.log(`H1 cell-weight:                r²=${bestH1.r2.toFixed(3)}  (K=${bestH1.K} cap=${bestH1.cap} scale=${bestH1.scale})`);
console.log(`H2 source-weight:              r²=${bestH2.r2.toFixed(3)}  (K=${bestH2.K} cap=${bestH2.cap} scale=${bestH2.scale})`);
console.log(`H3 ray-attenuated:             r²=${bestH3.r2.toFixed(3)}  (K=${bestH3.K} cap=${bestH3.cap} scale=${bestH3.scale})`);
console.log(`H4 per-terrain optimized:      r²=${(rH4 * rH4).toFixed(3)}`);

const best = [
  { name: "baseline", r2: rBaseSat * rBaseSat },
  { name: "H1 cell-weight", r2: bestH1.r2 },
  { name: "H2 source-weight", r2: bestH2.r2 },
  { name: "H3 ray-attenuated", r2: bestH3.r2 },
  { name: "H4 per-terrain", r2: rH4 * rH4 },
].sort((a, b) => b.r2 - a.r2)[0];
console.log(`\nBest overall: ${best.name}  r²=${best.r2.toFixed(3)}`);
