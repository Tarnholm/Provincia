// dig-mask-halo6.js — Push the SUM hypothesis further.

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

const posA = collectPositions(bufA);
const posB = collectPositions(bufB);
function uniqueMap(positions) {
  const m = new Map();
  for (const p of positions) {
    if (!m.has(p.uuid)) m.set(p.uuid, p);
    else { const ex = m.get(p.uuid); if (p.type > ex.type) m.set(p.uuid, p); }
  }
  return m;
}
const allA = [...uniqueMap(posA).values()];
const allB = [...uniqueMap(posB).values()];

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
  const r = dP * dO > 0 ? num / Math.sqrt(dP * dO) : 0;
  return r;
}
const vb = changed.map(c => c.vb);
const va = changed.map(c => c.va);

// Test sum hypothesis with wider K range, both Cheb and Euc
console.log(`Push SUM hypothesis: value ~= SUM_i max(0, K - dist(i)):`);
let bestSumB = { r2: -1 };
for (const K of [3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 25, 30]) {
  for (const metric of ["cheb", "euc", "man"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                 : metric === "man"  ? (c, s) => Math.abs(c.x - s.x) + Math.abs(c.y - s.y)
                 :                     (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = changed.map(c => {
      let s2 = 0;
      for (const s of allB) s2 += Math.max(0, K - distFn(c, s));
      return s2;
    });
    const r = correlate(pred, vb);
    const r2 = r * r;
    if (r2 > bestSumB.r2) bestSumB = { r2, K, metric, pred, r };
    if (r2 > 0.6) console.log(`  K=${K} ${metric.padEnd(4)}: r=${r.toFixed(3)} r²=${r2.toFixed(3)}`);
  }
}
console.log(`BEST SUM: K=${bestSumB.K} ${bestSumB.metric} r²=${bestSumB.r2.toFixed(3)}`);

// Also try just SUM of 1/dist with halo distance threshold
console.log(`\nINV-distance SUM: value ~= SUM_i 1/(dist+1):`);
for (const Rmax of [10, 15, 20, 30, 50, 100]) {
  for (const metric of ["cheb", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                                     : (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = changed.map(c => {
      let s2 = 0;
      for (const s of allB) {
        const d = distFn(c, s);
        if (d > Rmax) continue;
        s2 += 1 / (d + 1);
      }
      return s2;
    });
    const r = correlate(pred, vb);
    if (r * r > 0.5) console.log(`  Rmax=${Rmax} ${metric.padEnd(4)}: r=${r.toFixed(3)} r²=${(r*r).toFixed(3)}`);
  }
}

// Try with Gaussian/exponential weights
console.log(`\nGaussian weighted SUM: value ~= SUM_i exp(-d/sigma):`);
for (const sigma of [2, 3, 5, 7, 10, 15, 20, 30]) {
  for (const metric of ["cheb", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                                     : (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = changed.map(c => {
      let s2 = 0;
      for (const s of allB) s2 += Math.exp(-distFn(c, s) / sigma);
      return s2;
    });
    const r = correlate(pred, vb);
    if (r * r > 0.5) console.log(`  sigma=${sigma} ${metric.padEnd(4)}: r=${r.toFixed(3)} r²=${(r*r).toFixed(3)}`);
  }
}

// Show prediction grid for the best SUM fit
const bx0 = Math.min(...changed.map(c => c.x)), bx1 = Math.max(...changed.map(c => c.x));
const by0 = Math.min(...changed.map(c => c.y)), by1 = Math.max(...changed.map(c => c.y));
console.log(`\nGrid for best SUM (K=${bestSumB.K} ${bestSumB.metric}, scale-by-fit):`);
const predMap = new Map();
for (let i = 0; i < changed.length; i++) predMap.set(`${changed[i].x},${changed[i].y}`, bestSumB.pred[i]);
// Fit linear (predict → observed)
const allPred = [...bestSumB.pred], allObs = vb;
const mP = allPred.reduce((a, b) => a + b, 0) / allPred.length;
const mO = allObs.reduce((a, b) => a + b, 0) / allObs.length;
let num = 0, dP = 0;
for (let i = 0; i < allPred.length; i++) {
  num += (allPred[i] - mP) * (allObs[i] - mO);
  dP += (allPred[i] - mP) ** 2;
}
const slope = num / dP;
const intercept = mO - slope * mP;
console.log(`Linear fit: observed = ${slope.toFixed(2)} * predicted + ${intercept.toFixed(2)}`);
console.log(`PRED (raw)                                          PRED→OBS                                              OBSERVED`);
for (let y = by0; y <= by1; y++) {
  let pr = "", pr2 = "", ob = "";
  for (let x = bx0; x <= bx1; x++) {
    const p = predMap.get(`${x},${y}`);
    const c = changed.find(cc => cc.x === x && cc.y === y);
    pr += p === undefined ? "  ." : Math.round(p).toString().padStart(3, " ");
    pr2 += p === undefined ? "  ." : Math.round(slope * p + intercept).toString().padStart(3, " ");
    ob += c ? c.vb.toString().padStart(3, " ") : "   ";
  }
  console.log(`  ${pr}      ${pr2}      ${ob}`);
}

// Also do same test against A-side (va)
console.log(`\n\n----- A-side: predict va using A positions, SUM ${bestSumB.metric} K=${bestSumB.K} -----`);
const distFnA = bestSumB.metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                                            : (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
const predA = changed.map(c => {
  let s2 = 0;
  for (const s of allA) s2 += Math.max(0, bestSumB.K - distFnA(c, s));
  return s2;
});
const r_A = correlate(predA, va);
console.log(`A-side R²=${(r_A * r_A).toFixed(3)}`);

// Check: A-side prediction vs B-side prediction. Should differ only at
// positions where the ship moved.
let nDiff = 0;
for (let i = 0; i < changed.length; i++) {
  if (predA[i] !== bestSumB.pred[i]) nDiff++;
}
console.log(`A vs B prediction differ at ${nDiff}/${changed.length} cells.`);
