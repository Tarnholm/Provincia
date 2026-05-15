// dig-mask-s95-2.js — Session 95 attempt 2.
// Attempt 1 finding: ALL 100 changed cells are on uniform terrain
// (Fertile lowland, color 64,0,0). Terrain-of-cell cannot explain
// residual variance. Two remaining angles to test:
//
//   (a) The SOURCES — Roman ships near the bbox sit on water/coast.
//       The pred uses ALL 913 type-4/5/6 positions including enemies
//       on every continent. Maybe filtering to LOCAL sources (within
//       a halo radius) sharpens the fit. Session 42 noted r² didn't
//       improve from filtering by bbox-distance, but the SAT version
//       wasn't retried at all radii.
//   (b) TGA orientation may be flipped — let's verify by sampling
//       the source-ship location (should NOT be land).
//   (c) Per-source TYPE weighting — type-6 generals vs type-5 captains
//       vs type-4 ships may have DIFFERENT halo radii K. Session 42
//       used a single K for all source types.
//
// Plan:
//   1) Sanity check TGA orientation: type-4 ship at (337, 381) should
//      be on WATER. Sample with both orientations.
//   2) Test per-type halo radii: try K_6 (general), K_5 (captain),
//      K_4 (ship) independently to find the per-type-best fit.
//   3) Test filter-by-bbox-radius with the saturated formula.

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

// --- TGA setup ---
const TGA_PATH = "C:/dev/Provincia/public/map_ground_types_large.tga";
const tga = fs.readFileSync(TGA_PATH);
const TW = tga.readUInt16LE(12);
const TH = tga.readUInt16LE(14);
const TPD = tga[16] / 8;
const TIMG_OFF = 18 + tga[0];
const TIMG_DESC = tga[17];
const TGA_TOP_DOWN = (TIMG_DESC & 0x20) !== 0;
const SX = TW / W, SY = TH / H;
function sampleTga(mx, my, flip) {
  let tx = Math.min(TW - 1, Math.floor(mx * SX));
  let ty = Math.min(TH - 1, Math.floor(my * SY));
  if (flip) ty = TH - 1 - ty;
  const off = TIMG_OFF + (ty * TW + tx) * TPD;
  return [tga[off + 2], tga[off + 1], tga[off]];
}

// Sanity: type-4 ship in save_6 is at (337, 381). It should be on water
// or near-shore. Test both flips.
console.log(`TGA orientation sanity: type-4 ship at (337,381)`);
console.log(`  no-flip:    rgb=${sampleTga(337, 381, false).join(",")}`);
console.log(`  flip-y:     rgb=${sampleTga(337, 381, true).join(",")}`);

// Sample a few CHANGED cells in the bbox center (335, 380) with both flips
console.log(`\nBbox center (335,380):`);
console.log(`  no-flip:    rgb=${sampleTga(335, 380, false).join(",")}`);
console.log(`  flip-y:     rgb=${sampleTga(335, 380, true).join(",")}`);

// In RTW Imperial, the changed-cell bbox is near Italy SW coast. Let's
// also sample a known-water region and see which color encodes sea.
// (Mask coords (10,10) should be ocean at NW corner.)
console.log(`\nNW corner (10,10) — ocean expected:`);
console.log(`  no-flip:    rgb=${sampleTga(10, 10, false).join(",")}`);
console.log(`  flip-y:     rgb=${sampleTga(10, 10, true).join(",")}`);
// Looking at palette: (0,0,0)=Plains, (255,255,255)=Impassable; "sea" likely
// not in the palette at all (it's mapped to no-ground / outside). Hmm.

// --- TYPE distribution of all sources ---
const typeCounts = new Map();
for (const p of allB) typeCounts.set(p.type, (typeCounts.get(p.type) || 0) + 1);
console.log(`\nSource type counts: ${[...typeCounts.entries()].map(([t, n]) => `t${t}=${n}`).join("  ")}`);

const cheb = (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y));
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

// --- H5: Per-type halo radii ---
console.log(`\n=== H5: independent K_4 K_5 K_6 ===`);
let bestH5 = { r2: -1 };
for (const K6 of [8, 10, 11, 12, 14]) {
  for (const K5 of [8, 10, 11, 12, 14]) {
    for (const K4 of [8, 10, 11, 12, 14]) {
      const raw = changed.map(c => {
        let s = 0;
        for (const src of allB) {
          const K = src.type === 6 ? K6 : src.type === 5 ? K5 : K4;
          s += Math.max(0, K - cheb(c, src));
        }
        return s;
      });
      for (const cap of [7, 8, 9, 10]) {
        for (const scale of [0.15, 0.20, 0.25, 0.30]) {
          const pred = raw.map(v => Math.min(cap, Math.floor(v * scale)));
          const r = correlate(pred, vb);
          const r2 = r * r;
          if (r2 > bestH5.r2) bestH5 = { r2, K6, K5, K4, cap, scale };
        }
      }
    }
  }
}
console.log(`H5 best: K6=${bestH5.K6} K5=${bestH5.K5} K4=${bestH5.K4} cap=${bestH5.cap} scale=${bestH5.scale} r²=${bestH5.r2.toFixed(3)}`);

// --- H6: only sources of one type ---
console.log(`\n=== H6: filter sources by type ===`);
for (const tFilter of [[4], [5], [6], [4, 5], [4, 6], [5, 6], [4, 5, 6]]) {
  const sub = allB.filter(p => tFilter.includes(p.type));
  let best = { r2: -1 };
  for (const K of [8, 10, 11, 12, 14]) {
    const raw = changed.map(c => {
      let s = 0;
      for (const src of sub) s += Math.max(0, K - cheb(c, src));
      return s;
    });
    for (const cap of [7, 8, 9]) {
      for (const scale of [0.15, 0.20, 0.25, 0.30]) {
        const pred = raw.map(v => Math.min(cap, Math.floor(v * scale)));
        const r = correlate(pred, vb);
        const r2 = r * r;
        if (r2 > best.r2) best = { r2, K, cap, scale };
      }
    }
  }
  console.log(`  types=[${tFilter.join(",")}] n=${sub.length}  best K=${best.K} cap=${best.cap} scale=${best.scale} r²=${best.r2.toFixed(3)}`);
}

// --- H7: distance filter — only sources within RADIUS of bbox ---
console.log(`\n=== H7: filter sources by distance from bbox ===`);
const bx0 = Math.min(...changed.map(c => c.x)), bx1 = Math.max(...changed.map(c => c.x));
const by0 = Math.min(...changed.map(c => c.y)), by1 = Math.max(...changed.map(c => c.y));
function distToBbox(p) {
  const dx = p.x < bx0 ? bx0 - p.x : p.x > bx1 ? p.x - bx1 : 0;
  const dy = p.y < by0 ? by0 - p.y : p.y > by1 ? p.y - by1 : 0;
  return Math.max(dx, dy);
}
for (const Rmax of [5, 8, 11, 15, 20, 30, 50]) {
  const sub = allB.filter(p => distToBbox(p) <= Rmax);
  let best = { r2: -1 };
  for (const K of [8, 10, 11, 12, 14, 16]) {
    const raw = changed.map(c => {
      let s = 0;
      for (const src of sub) s += Math.max(0, K - cheb(c, src));
      return s;
    });
    for (const cap of [7, 8, 9]) {
      for (const scale of [0.15, 0.20, 0.25, 0.30, 0.50, 0.75, 1.00]) {
        const pred = raw.map(v => Math.min(cap, Math.floor(v * scale)));
        const r = correlate(pred, vb);
        const r2 = r * r;
        if (r2 > best.r2) best = { r2, K, cap, scale };
      }
    }
  }
  console.log(`  Rmax=${Rmax.toString().padStart(2)}  n=${sub.length.toString().padStart(3)}  best K=${best.K} cap=${best.cap} scale=${best.scale} r²=${best.r2.toFixed(3)}`);
}

// --- H8: log/sqrt transform on the per-source contribution ---
console.log(`\n=== H8: nonlinear per-source contribution ===`);
let bestH8 = { r2: -1 };
const sub = allB.filter(p => distToBbox(p) <= 20);
for (const K of [11, 12, 14, 16]) {
  for (const exp of [0.5, 0.7, 1.0, 1.3, 1.6, 2.0]) {
    const raw = changed.map(c => {
      let s = 0;
      for (const src of sub) {
        const d = cheb(c, src);
        if (d >= K) continue;
        s += Math.pow(K - d, exp);
      }
      return s;
    });
    for (const cap of [7, 8, 9]) {
      for (const scale of [0.02, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.50, 1.0]) {
        const pred = raw.map(v => Math.min(cap, Math.floor(v * scale)));
        const r = correlate(pred, vb);
        const r2 = r * r;
        if (r2 > bestH8.r2) bestH8 = { r2, K, exp, cap, scale };
      }
    }
  }
}
console.log(`H8 best: K=${bestH8.K} exp=${bestH8.exp} cap=${bestH8.cap} scale=${bestH8.scale} r²=${bestH8.r2.toFixed(3)}`);

// --- H9: try terrain-of-SOURCE for fleets vs land — fleet ships sit on
//     water and may have a DIFFERENT effective K than land sources. ---
console.log(`\n=== H9: classify sources by their terrain (water vs land) ===`);
function isWaterLike(rgb) {
  // RTW ground types don't enumerate "sea" — sea pixels are outside the
  // playable area. But the TGA may use (0,0,0) or another marker. Check by
  // sampling. For now treat "no terrain match" as water.
  return false;
}
// Easier: split by whether source is in our changed-cell vicinity.
// Cluster source positions and see if "ship at coast" sources have a
// distinct halo than land sources.
// For each source within 20px of bbox, log its (type, x, y, terrain).
console.log(`Sources within 20px of bbox:`);
for (const src of sub) {
  const [r, g, b] = sampleTga(src.x, src.y, false);
  const palette = {
    "0,0,0": "Plains", "64,0,0": "FertLow", "196,0,0": "Highland",
    "0,128,128": "Mountain", "101,124,0": "Shrub", "0,128,0": "Forest",
    "128,128,64": "SandDes", "128,0,0": "Rocky", "98,65,65": "RockyDes",
    "0,64,0": "DenseForest", "196,128,128": "OpenScrub",
    "0,255,128": "Swamp", "96,160,64": "LightForest", "255,255,255": "Impassable"
  };
  const tName = palette[`${r},${g},${b}`] || `unk(${r},${g},${b})`;
  console.log(`  t${src.type} (${src.x},${src.y}) terrain=${tName}`);
}

// --- SUMMARY ---
console.log(`\n=== SUMMARY ===`);
console.log(`Baseline (s42):                                 r²=0.700`);
console.log(`H5 per-type K:                                  r²=${bestH5.r2.toFixed(3)}`);
console.log(`H8 nonlinear contribution:                      r²=${bestH8.r2.toFixed(3)}`);
