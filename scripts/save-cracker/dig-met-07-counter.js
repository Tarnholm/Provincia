// dig-met-07-counter.js
// HYPOTHESIS from dig-met-03: the diplomacy attitude matrix cell field
// counter(+20) splits ~56672 cells at default value 6 vs ~210 cells at 54/55.
// That small set is a strong "met / contacted" candidate. This script:
//   (1) correctly identifies the PLAYER faction index from the save (via the
//       major class-100 records + faction banner, then maps to faction order),
//   (2) dumps the player's matrix ROW (player vs every B) showing att + flag +
//       counter, listing every B whose counter != default,
//   (3) prints the full set of (A,B) cells whose counter is non-default so we
//       can compare T0 vs later for growth.
"use strict";
const fs = require("fs");
const path = require("path");
const X = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadOrder(p) {
  const t = fs.readFileSync(p, "utf8"); const o = []; let c = null;
  for (const l of t.split(/\r?\n/)) {
    const m = l.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (m) { c = m[1]; continue; }
    if (c) { const cm = l.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { o.push(c); c = null; } }
  }
  return o;
}
const order = loadOrder(RIS_FACTIONS);
const N = order.length;

function locate(buf) {
  const okAtt = (v) => v >= 0 && v <= 1000;
  const limit = Math.min(buf.length - 64, 0x400000);
  for (let p = 0x4000; p < limit; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const key = buf.readUInt32LE(p + 4);
    if (key < 1 || key > 64) continue;
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    if (!okAtt(buf.readUInt32LE(p + 12))) continue;
    if (buf.readUInt32LE(p + 16) !== 2) continue;
    const runFor = (s) => {
      let good = 0;
      for (let k = 0; k < N + 2; k++) {
        const o = p + k * s;
        if (o + 12 >= buf.length) break;
        if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === key && buf.readUInt32LE(o + 8) === 200) good++;
        else break;
      }
      return good;
    };
    for (let s = 80; s <= 400; s++) {
      if (p + s + 12 >= buf.length) break;
      if (buf.readUInt32LE(p + s) === 0 && buf.readUInt32LE(p + s + 4) === key && buf.readUInt32LE(p + s + 8) === 200) {
        if (runFor(s) >= N) return { cellStart: p, stride: s, key };
      }
    }
  }
  return null;
}
function calibC(buf, loc) {
  const att = (idx) => { const o = loc.cellStart + idx * loc.stride + 12; return o + 4 <= buf.length ? buf.readUInt32LE(o) : null; };
  let bestC = 0, best = -1;
  for (let C = -3; C <= 3; C++) { let sym = 0, tot = 0; for (let A = 1; A < N; A += 3) for (let B = A + 1; B < N; B += 3) { const v1 = att(A * N + B + C), v2 = att(B * N + A + C); if (v1 == null || v2 == null) continue; tot++; if (v1 === v2) sym++; } const sc = tot ? sym / tot : 0; if (sc > best) { best = sc; bestC = C; } }
  return bestC;
}

function playerFid(buf) {
  // Use banner heuristic -> map name to order index.
  const recs = X.parseFactionTreasuries(buf);
  const player = X.identifyPlayerFactionFromSave(buf, recs);
  const idx = player ? order.indexOf(player) : -1;
  return { name: player, idx };
}

const saves = process.argv.slice(2);
for (const s of saves) {
  const buf = fs.readFileSync(SAVES_DIR + s);
  const loc = locate(buf);
  if (!loc) { console.log(`\n### ${s}: matrix NOT found`); continue; }
  const C = calibC(buf, loc);
  const cell = (A, B) => {
    const o = loc.cellStart + (A * N + B + C) * loc.stride;
    if (o + 24 > buf.length) return null;
    return { att: buf.readUInt32LE(o + 12), flag: buf.readUInt32LE(o + 16), ctr: buf.readUInt32LE(o + 20), off: o };
  };
  const pf = playerFid(buf);
  console.log(`\n############### ${s}`);
  console.log(`cellStart=0x${loc.cellStart.toString(16)} stride=${loc.stride} key=${loc.key} C=${C} N=${N}`);
  console.log(`player banner=${pf.name} -> orderIdx=${pf.idx}`);

  // Global counter histogram + which value is "default"
  const ctrHist = {};
  for (let A = 0; A < N; A++) for (let B = 0; B < N; B++) { if (A === B) continue; const c = cell(A, B); if (!c) continue; ctrHist[c.ctr] = (ctrHist[c.ctr] || 0) + 1; }
  const sorted = Object.entries(ctrHist).sort((a, b) => b[1] - a[1]);
  const defCtr = Number(sorted[0][0]);
  console.log(`counter hist: ${sorted.slice(0, 8).map(([k, v]) => `${k}:${v}`).join("  ")}  (default=${defCtr})`);

  // ALL non-default-counter cells (the candidate "met" set) — as unordered pairs.
  const pairSet = new Set();
  for (let A = 0; A < N; A++) for (let B = A + 1; B < N; B++) {
    const c1 = cell(A, B), c2 = cell(B, A);
    if (!c1 || !c2) continue;
    if (c1.ctr !== defCtr || c2.ctr !== defCtr) {
      pairSet.add(`${order[A]} <-> ${order[B]} | A(ctr=${c1.ctr},att=${c1.att}) B(ctr=${c2.ctr},att=${c2.att})`);
    }
  }
  console.log(`non-default-counter PAIRS: ${pairSet.size}`);
  for (const p of [...pairSet].slice(0, 60)) console.log(`   ${p}`);

  // Player row: list every B with att != 200 OR ctr != default.
  if (pf.idx >= 0) {
    console.log(`\n--- PLAYER ROW (${order[pf.idx]}) non-default cells ---`);
    let n = 0;
    for (let B = 0; B < N; B++) {
      if (B === pf.idx) continue;
      const c = cell(pf.idx, B);
      if (!c) continue;
      if (c.att !== 200 || c.ctr !== defCtr) {
        n++;
        console.log(`   B=${String(B).padStart(3)} ${order[B].padEnd(22)} att=${c.att} flag=${c.flag} ctr=${c.ctr}`);
      }
    }
    console.log(`   player non-default cells: ${n}`);
  }
}
