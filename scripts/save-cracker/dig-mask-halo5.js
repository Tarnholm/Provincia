// dig-mask-halo5.js — Final attempt.
// Use ALL positions in the buffer (not just nearby), test halo with
// larger K. Also test "min-distance directly" (not K - dist).

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
const mapA = uniqueMap(posA);
const mapB = uniqueMap(posB);
const allA = [...mapA.values()];
const allB = [...mapB.values()];
console.log(`All A positions: ${allA.length}, B: ${allB.length}`);

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
  if (Math.abs(r) > 0.7) console.log(`  ${label.padEnd(60)} r=${r.toFixed(3)} r²=${(r*r).toFixed(3)} **`);
  else if (Math.abs(r) > 0.5) console.log(`  ${label.padEnd(60)} r=${r.toFixed(3)} r²=${(r*r).toFixed(3)}`);
  return r * r;
}
const vb = changed.map(c => c.vb);
const va = changed.map(c => c.va);

console.log(`\n--- Test using ALL positions (not just nearby) ---`);
// Just use them all, in case faction-0 has positions far away
for (const K of [8, 10, 12, 15, 20]) {
  for (const metric of ["cheb", "man", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                 : metric === "man"  ? (c, s) => Math.abs(c.x - s.x) + Math.abs(c.y - s.y)
                 :                     (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = changed.map(c => {
      let best = 0;
      for (const s of allB) {
        const d = distFn(c, s);
        const v = Math.max(0, K - Math.floor(d));
        if (v > best) best = v;
      }
      return best;
    });
    correlate(pred, vb, `all-B K=${K} ${metric} max → vb`);
  }
}

// What if value = clamp distance to nearest, not subtracted?
console.log(`\n--- Test: value = clamp(min_dist, 0..N) directly (no subtraction) ---`);
for (const N of [5, 7, 9, 15, 20]) {
  for (const metric of ["cheb", "man", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                 : metric === "man"  ? (c, s) => Math.abs(c.x - s.x) + Math.abs(c.y - s.y)
                 :                     (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = changed.map(c => {
      let minD = Infinity;
      for (const s of allB) {
        const d = distFn(c, s);
        if (d < minD) minD = d;
      }
      return Math.min(N, Math.floor(minD));
    });
    correlate(pred, vb, `all-B clamp-min N=${N} ${metric} → vb`);
  }
}

// Now, try using SETTLEMENTS too (those have their own coord encoding).
// Per RESEARCH: settlement coords at +341/+345 u32. Let me search:
// But faster — look for SETTLEMENT records by their typical signature.
// Save-cracker has settlement coord parsers but skipping for time.

// === Possibly the metric is something specific: |dx| + 2*|dy|? Let me check ratios ===
// The mask might have anisotropic distance (2:1 X:Y ratio).
console.log(`\n--- Test anisotropic distance metrics ---`);
const metrics = {
  "cheb_2x": (c, s) => Math.max(Math.abs(c.x - s.x) / 2, Math.abs(c.y - s.y)),
  "cheb_x2y": (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y) * 2),
  "cheb_4x": (c, s) => Math.max(Math.abs(c.x - s.x) / 4, Math.abs(c.y - s.y)),
  "cheb_x4y": (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y) * 4),
};
for (const [name, fn] of Object.entries(metrics)) {
  for (const K of [6, 8, 10, 12, 15, 20]) {
    const pred = changed.map(c => {
      let best = 0;
      for (const s of allB) {
        const d = fn(c, s);
        const v = Math.max(0, K - Math.floor(d));
        if (v > best) best = v;
      }
      return best;
    });
    correlate(pred, vb, `all-B K=${K} ${name} → vb`);
  }
}

// === Maybe the value is NUM characters within radius R ===
console.log(`\n--- Test: value = count of Romans within radius R ---`);
for (const R of [5, 7, 10, 15, 20]) {
  for (const metric of ["cheb", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                                     : (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = changed.map(c => {
      let cnt = 0;
      for (const s of allB) if (distFn(c, s) <= R) cnt++;
      return cnt;
    });
    correlate(pred, vb, `all-B count R=${R} ${metric} → vb`);
  }
}

// === Maybe sum of (max(0, K - dist)) over all sources (not max) ===
console.log(`\n--- Test: value = SUM over Romans of max(0, K - dist) ---`);
for (const K of [3, 5, 7, 10]) {
  for (const metric of ["cheb", "euc"]) {
    const distFn = metric === "cheb" ? (c, s) => Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y))
                                     : (c, s) => Math.sqrt((c.x - s.x) ** 2 + (c.y - s.y) ** 2);
    const pred = changed.map(c => {
      let s2 = 0;
      for (const s of allB) {
        s2 += Math.max(0, K - distFn(c, s));
      }
      return s2;
    });
    correlate(pred, vb, `all-B SUM K=${K} ${metric} → vb`);
  }
}
