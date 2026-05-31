// Focused probe for Raymond T5: relax the cell signature and hunt for a SPARSE
// symmetric NxN state matrix. The strict locator's signature is +0==0, +8==200,
// +16==2; maybe +16 differs on Republic-of-Rome saves. Try variants.
"use strict";
const fs = require("fs");
const path = require("path");

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}

const save = process.argv[2];
const mod = process.argv[3] || "C:\\RIS\\RIS\\data";
const buf = fs.readFileSync(save);
const N = loadFactionOrder(path.join(mod, "descr_sm_factions.txt")).length;
console.log(`save=${path.basename(save)} N=${N} size=${(buf.length/1e6).toFixed(2)}MB`);

// Try several cell signatures. For each, find N-runs at dynamic stride, walk to
// rough(0,0), sweep alignment by state-symmetry, and report the best SPARSE one.
const sigVariants = {
  "0/200/2@16(strict)": (o)=> buf.readUInt32LE(o)===0 && buf.readUInt32LE(o+8)===200 && buf.readUInt32LE(o+16)===2,
  "0/200 (no +16)":     (o)=> buf.readUInt32LE(o)===0 && buf.readUInt32LE(o+8)===200,
  "0/200/1@16":         (o)=> buf.readUInt32LE(o)===0 && buf.readUInt32LE(o+8)===200 && buf.readUInt32LE(o+16)===1,
};

const stateAt = (base, stride, r, c) => {
  const o = base + (r * N + c) * stride + 12;
  return (o >= 0 && o + 4 <= buf.length) ? buf.readInt32LE(o) : null;
};

for (const [label, sigFn] of Object.entries(sigVariants)) {
  const sig = (o)=> o>=0 && o+20<=buf.length && sigFn(o);
  const t0 = Date.now();
  const sigPositions = [];
  for (let p = 0x4000; p + 20 <= buf.length; p++) if (sig(p)) sigPositions.push(p);
  const sigSet = new Set(sigPositions);
  // dynamic stride run starts
  const roughs = new Map(); // tag -> {rough, stride}
  for (const p of sigPositions) {
    const key = buf.readUInt32LE(p + 4);
    let stride = 0;
    for (let s = 80; s <= 400; s++) {
      if (!sigSet.has(p + s)) continue;
      let run = 0; for (let k = 0; k < N; k++) { if (sigSet.has(p + k * s)) run++; else break; }
      if (run >= N) { stride = s; break; }
    }
    if (!stride) continue;
    let rough = p; while (sigSet.has(rough - stride)) rough -= stride;
    roughs.set(rough + ":" + stride, { rough, stride });
  }
  // sweep each rough; track best by (symmetry desc, then sparsity = fewest nonNeutral)
  let best = null;
  for (const { rough, stride } of roughs.values()) {
    let cand = { frac: -1, base: rough, k: 0, tot: 1e9 };
    for (let k = -40; k <= 40; k++) {
      const base = rough + k * stride;
      let sym = 0, tot = 0;
      for (let r = 0; r < N; r++) for (let c = r + 1; c < N; c++) {
        const a = stateAt(base, stride, r, c), b = stateAt(base, stride, c, r);
        if (a == null || b == null) continue;
        if (a !== 200 || b !== 200) { tot++; if (a === b) sym++; }
      }
      const frac = tot ? sym / tot : 0;
      // prefer high symmetry AND sparse (a real T5 matrix has few non-neutral pairs)
      if (frac > cand.frac || (frac === cand.frac && tot < cand.tot)) cand = { frac, base, k, tot };
    }
    // best across roughs: prefer high frac with reasonable sparsity (tot < N*2)
    const score = (c)=> c.frac - (c.tot > N*3 ? 0.5 : 0); // penalize dense noise
    if (!best || score(cand) > score(best)) best = cand;
  }
  console.log(`[${label}] ${Date.now()-t0}ms sigPos=${sigPositions.length} roughs=${roughs.size} -> best frac=${best?best.frac.toFixed(4):"-"} base=${best?best.base+8:"-"} k=${best?best.k:"-"} nonNeutralPairs=${best?best.tot:"-"}`);
}
