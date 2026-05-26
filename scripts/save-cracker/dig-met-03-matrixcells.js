// dig-met-03-matrixcells.js
// Test whether the N×N attitude matrix encodes "met" in a per-cell field other
// than attitude. Each cell (located via locateDiplomacyMatrix) is:
//   +0 u32 ==0 | +4 u32 key | +8 u32 ==200 baseline | +12 attitude | +16 flag |
//   +20 counter ...
// Ground truth: at T0 a faction has met only neighbors+scripted. So most cells
// should look "unmet" and a SMALL number "met". Hypothesis: flag(+16) or
// counter(+20) (or attitude!=200) distinguishes met from unmet.
//
// We dump, for the player faction's ROW (player vs every other faction), the
// per-cell attitude/flag/counter, and a histogram across ALL cells, to see if
// there's a binary field that splits ~small-met vs large-unmet.
"use strict";
const fs = require("fs");
const X = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const RIS_FACTIONS = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";

function loadFactionOrder(p) {
  const txt = fs.readFileSync(p, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(RIS_FACTIONS);
const N = order.length;

// re-implement locator to also get the raw 'base' (start of cell, the +0==0 word)
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

const save = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(SAVES_DIR + save);
const loc = locate(buf);
console.log(`### ${save}`);
if (!loc) { console.log("matrix not found"); process.exit(0); }
console.log(`cellStart=0x${loc.cellStart.toString(16)} stride=${loc.stride} key=${loc.key} N=${N}`);

// cell(idx) = loc.cellStart + idx*stride ; idx = A*N + B + C. Calibrate C by
// symmetry of attitude.
function attAt(idx) {
  const o = loc.cellStart + idx * loc.stride + 12;
  if (o + 4 > buf.length) return null;
  return buf.readUInt32LE(o);
}
function cellAt(idx) {
  const o = loc.cellStart + idx * loc.stride;
  if (o + 24 > buf.length) return null;
  return {
    w0: buf.readUInt32LE(o), key: buf.readUInt32LE(o + 4), base: buf.readUInt32LE(o + 8),
    att: buf.readUInt32LE(o + 12), flag: buf.readUInt32LE(o + 16), counter: buf.readUInt32LE(o + 20),
  };
}
let bestC = 0, best = -1;
for (let C = -3; C <= 3; C++) {
  let sym = 0, tot = 0;
  for (let A = 1; A < N; A += 7) for (let B = A + 1; B < N; B += 5) {
    const v1 = attAt(A * N + B + C), v2 = attAt(B * N + A + C);
    if (v1 == null || v2 == null) continue;
    tot++; if (v1 === v2) sym++;
  }
  const sc = tot ? sym / tot : 0;
  if (sc > best) { best = sc; bestC = C; }
}
const C = bestC;
console.log(`calibrated C=${C} symmetry=${best.toFixed(3)}`);

// Global histograms of att/flag/counter across the whole matrix.
const attHist = {}, flagHist = {}, ctrHist = {}, baseHist = {};
let cells = 0;
for (let A = 0; A < N; A++) for (let B = 0; B < N; B++) {
  if (A === B) continue;
  const c = cellAt(A * N + B + C);
  if (!c) continue;
  cells++;
  attHist[c.att] = (attHist[c.att] || 0) + 1;
  flagHist[c.flag] = (flagHist[c.flag] || 0) + 1;
  ctrHist[c.counter] = (ctrHist[c.counter] || 0) + 1;
  baseHist[c.base] = (baseHist[c.base] || 0) + 1;
}
const top = (h, n = 10) => Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ");
console.log(`cells scanned=${cells}`);
console.log(`att hist:    ${top(attHist)}`);
console.log(`base(+8):    ${top(baseHist)}`);
console.log(`flag(+16):   ${top(flagHist)}`);
console.log(`counter(+20):${top(ctrHist)}`);

// PLAYER ROW dump: identify player faction from save and dump its row.
const recs = X.parseFactionTreasuries(buf);
const player = X.identifyPlayerFactionFromSave(buf, recs);
// Find the player's diplomacy-zone fid (more reliable than banner).
function playerFidFromZone() {
  const MARKER = 0x39240005;
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 250) continue;
    if (i + 24 > buf.length) continue;
    if (buf.readUInt32LE(i + 20) === 0) return buf[i - 53];
  }
  return null;
}
const pfid = playerFidFromZone();
console.log(`\nplayer banner=${player} playerZoneFid=${pfid}(${pfid != null && pfid < N ? order[pfid] : "?"})`);
if (pfid != null && pfid < N) {
  console.log(`\n=== player row (A=${pfid}=${order[pfid]} vs B) non-neutral / non-200-base cells ===`);
  let nonDefault = 0;
  for (let B = 0; B < N; B++) {
    if (B === pfid) continue;
    const c = cellAt(pfid * N + B + C);
    if (!c) continue;
    // "default unmet" candidate = att==200 && flag==X && counter==Y (the modal)
    if (c.att !== 200 || c.flag !== 0 || c.counter !== 0) {
      nonDefault++;
      if (nonDefault <= 60) console.log(`  B=${String(B).padStart(3)} ${order[B].padEnd(22)} att=${c.att} base=${c.base} flag=${c.flag} ctr=${c.counter}`);
    }
  }
  console.log(`player row non-default cells: ${nonDefault} / ${N - 1}`);
}
