// scripts/probe-diplo-locator.js — diagnose the diplomacy-matrix locator.
//
// STEP 1: brute-force the WHOLE file for the 239xN matrix to find the TRUE
// offset, then compare against the production locateDiplomacyMatrix to see why
// it misses (8MB cap? work-budget exhaustion on pre-matrix false candidates?).
//
// Usage: node scripts/probe-diplo-locator.js <save.sav> [--mod <dir>]
"use strict";
const fs = require("fs");
const path = require("path");
const ext = require("../src/saveCrackerExtras.js");

function loadFactionOrder(p) {
  let txt;
  try { txt = fs.readFileSync(p, "utf8"); } catch { return null; }
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order.length ? order : null;
}

const argv = process.argv.slice(2);
let save = null, mod = "C:\\RIS\\RIS\\data";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--mod") mod = argv[++i];
  else if (!save) save = argv[i];
}
const buf = fs.readFileSync(save);
const smOrder = loadFactionOrder(path.join(mod, "descr_sm_factions.txt"));
const N = smOrder.length;
console.log(`save=${path.basename(save)} size=${(buf.length/1e6).toFixed(2)}MB N=${N}`);

// --- brute-force whole-file scan, no cap ---
const sig = (o) => o >= 0 && o + 20 <= buf.length &&
  buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 8) === 200 && buf.readUInt32LE(o + 16) === 2;
const stateAt = (base, stride, r, c) => {
  const o = base + (r * N + c) * stride + 12;
  return (o >= 0 && o + 4 <= buf.length) ? buf.readInt32LE(o) : null;
};

const t0 = Date.now();
// Phase A: collect every sig position (one cheap pass).
const sigPositions = [];
for (let p = 0x4000; p + 20 <= buf.length; p++) { if (sig(p)) sigPositions.push(p); }
const sigSet = new Set(sigPositions);
const tA = Date.now();
console.log(`phase A (collect sig positions): ${tA-t0}ms, total sig positions=${sigPositions.length}, first=0x${sigPositions[0]?.toString(16)} last=0x${sigPositions[sigPositions.length-1]?.toString(16)}`);

// Phase B: detect stride dynamically per candidate (smallest s in 80..400 giving
// an N-long same-key signature run), like production. Collect N-run starts + stride.
const runStarts = [];
for (const p of sigPositions) {
  const key = buf.readUInt32LE(p + 4);
  if (key < 1 || key > 64) continue;
  let stride = 0;
  for (let s = 80; s <= 400; s++) {
    if (!sigSet.has(p + s) || buf.readUInt32LE(p + s + 4) !== key) continue;
    let run = 0;
    for (let k = 0; k < N; k++) { if (sigSet.has(p + k * s)) run++; else break; }
    if (run >= N) { stride = s; break; }
  }
  if (stride) runStarts.push({ p, stride, key });
}
const tB = Date.now();
const strideHist = {};
for (const r of runStarts) strideHist[r.stride] = (strideHist[r.stride]||0)+1;
console.log(`phase B (dynamic-stride N-run starts): ${tB-tA}ms, count=${runStarts.length}, strides=${JSON.stringify(strideHist)}`);

// Phase C: validate each distinct rough(0,0)+stride by FULL symmetry sweep (no early break).
const found = [];
const seenRough = new Set();
const candidates = sigPositions.length;
for (const rs of runStarts) {
  const STRIDE = rs.stride;
  let rough = rs.p;
  while (sigSet.has(rough - STRIDE)) rough -= STRIDE;
  const tag = rough + ":" + STRIDE;
  if (seenRough.has(tag)) continue;
  seenRough.add(tag);
  let best = { frac: -1, base: rough, k: 0, tot: 0 };
  for (let k = -40; k <= 40; k++) {
    const base = rough + k * STRIDE;
    let sym = 0, tot = 0;
    for (let r = 0; r < N; r++) for (let c = r + 1; c < N; c++) {
      const a = stateAt(base, STRIDE, r, c), b = stateAt(base, STRIDE, c, r);
      if (a == null || b == null) continue;
      if (a !== 200 || b !== 200) { tot++; if (a === b) sym++; }
    }
    const frac = tot ? sym / tot : 0;
    if (frac > best.frac) best = { frac, base, k, tot };
    if (best.frac >= 0.999) break;
  }
  found.push({ p: rs.p, rough, stride: STRIDE, base: best.base, k: best.k, frac: best.frac, tot: best.tot, key: rs.key });
}
const dt = Date.now() - t0;
console.log(`brute scan total: ${dt}ms, sig-candidates=${candidates}, distinct rough(0,0)=${seenRough.size}`);
found.sort((a,b)=>b.frac-a.frac);
console.log(`all rough-candidates evaluated (top by frac):`);
for (const f of found.slice(0,12)) console.log(`  rough=0x${f.rough.toString(16)} stride=${f.stride} base=${f.base} readerBase=${f.base+8} k=${f.k} frac=${f.frac.toFixed(4)} pairs=${f.tot} key=${f.key}`);
// keep only real matrices for the summary below
const realFound = found.filter(f=>f.frac>=0.8);
found.length = 0; realFound.forEach(f=>found.push(f));
console.log(`matrices found (frac>=0.8): ${found.length}`);
for (const f of found) {
  console.log(`  base=${f.base} (0x${f.base.toString(16)}) readerBase=${f.base+8} k=${f.k} frac=${f.frac.toFixed(4)} nonNeutralPairs=${f.tot} key=${f.key} firstCell=0x${f.rough.toString(16)}`);
}

// --- count sig candidates BELOW the 8MB cap (what prod sees) ---
const CAP = 0x800000;
let sigBelowCap = 0, sigAboveCap = 0;
for (let p = 0x4000; p + 20 <= buf.length; p++) {
  if (!sig(p)) continue;
  if (p < CAP) sigBelowCap++; else sigAboveCap++;
}
console.log(`sig candidates below 8MB cap: ${sigBelowCap}  above cap: ${sigAboveCap}`);
if (found.length) {
  const m = found[0];
  console.log(`TRUE matrix readerBase=${m.base+8} is ${m.base+8 < CAP ? "BELOW" : "ABOVE"} the 8MB cap (0x${CAP.toString(16)})`);
}

// --- run the production parser with timing (uses locateDiplomacyMatrix internally) ---
const tp = Date.now();
const m = ext.parseDiplomacyMatrix(buf, smOrder);
const dtp = Date.now()-tp;
if (!m) { console.log(`PROD parseDiplomacyMatrix: ${dtp}ms -> null`); }
else {
  console.log(`PROD parseDiplomacyMatrix: ${dtp}ms -> meta=${JSON.stringify(m._meta)}`);
  // sanity: julii war/ally counts
  const julii = m["romans_julii"];
  if (julii) console.log(`  romans_julii: wars=${julii.war.length} [${julii.war.slice(0,8).join(",")}] allies=${julii.allied.length} [${julii.allied.slice(0,8).join(",")}]`);
}
