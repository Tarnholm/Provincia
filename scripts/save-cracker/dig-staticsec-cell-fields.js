// dig-staticsec-cell-fields.js
// Decode the per-cell extra fields of the attitude matrix and CROSS-VALIDATE
// attitude against descr_strat faction_relationships ground truth.
// Also reconcile field offsets with RESEARCH.md's f16/f20/f24/f28/f32 naming
// (RESEARCH.md indexed fields from base=cellStart+8, i.e. RESEARCH f0 == our +8).
const fs = require("fs");
const DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const SAVE = DIR + "save_macedon t0.sav";
const ORDER = "C:\\RIS\\RIS\\data\\descr_sm_factions.txt";
const STRAT = "C:\\RIS\\RIS\\data\\world\\maps\\campaign\\imperial_campaign\\descr_strat.txt";

function loadOrder(p) {
  const txt = fs.readFileSync(p, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
function locateMatrix(buf, N) {
  for (let p = 0x4000; p < buf.length - 64; p++) {
    if (buf.readUInt32LE(p) !== 0) continue;
    const key = buf.readUInt32LE(p + 4);
    if (key < 1 || key > 64) continue;
    if (buf.readUInt32LE(p + 8) !== 200) continue;
    const a = buf.readUInt32LE(p + 12); if (a < 0 || a > 1000) continue;
    if (buf.readUInt32LE(p + 16) !== 2) continue;
    const runFor = (s) => { let g = 0; for (let k = 0; k < N + 2; k++) { const o = p + k * s; if (o + 12 >= buf.length) break; if (buf.readUInt32LE(o) === 0 && buf.readUInt32LE(o + 4) === key && buf.readUInt32LE(o + 8) === 200) g++; else break; } return g; };
    for (let s = 80; s <= 400; s++) { if (p + s + 12 >= buf.length) break; if (buf.readUInt32LE(p + s) === 0 && buf.readUInt32LE(p + s + 4) === key && buf.readUInt32LE(p + s + 8) === 200 && runFor(s) >= N) return { cellStart: p, base: p + 8, stride: s, key }; }
  }
  return null;
}

const buf = fs.readFileSync(SAVE);
const order = loadOrder(ORDER);
const N = order.length;
const m = locateMatrix(buf, N);
const cells = N * N;
const C = -1; // RIS calibration constant
const idxOf = name => order.indexOf(name);
const cellOff = (A, B) => m.cellStart + (A * N + B + C) * m.stride;
const attOf = (A, B) => buf.readUInt32LE(cellOff(A, B) + 12);

console.log(`matrix cellStart=0x${m.cellStart.toString(16)} stride=${m.stride} key=${m.key} N=${N} C=${C}`);
console.log(`NOTE: RESEARCH.md indexed fields from base=cellStart+8. So RESEARCH "fX" == our "+ (X+8)".`);
console.log(`  RESEARCH f0 == +8 (key... actually base200), f4 == +12, f8 == +16, f12 == +20, f16 == +24, f20 == +28, f24 == +32, f28 == +36, f32 == +40`);
console.log(`  (RESEARCH base=cellStart+8, so its 'f16/f24/f28/f32' = our +24/+32/+36/+40)`);

// ---- Field decode at every byte-offset 0..stride, count distinct & top values ----
console.log(`\n=== FULL FIELD SCAN (u32 at every 4-byte offset within cell, ${cells} valid cells, skip last partial) ===`);
const validCells = cells - 1; // last cell tail runs past section end; skip it for clean stats
for (let off = 0; off + 4 <= m.stride; off += 4) {
  const h = new Map();
  for (let i = 0; i < validCells; i++) { const v = buf.readUInt32LE(m.cellStart + i * m.stride + off); h.set(v, (h.get(v)||0)+1); }
  if (h.size === 1) {
    const [v] = [...h.keys()];
    if (v !== 0) console.log(`  +${off}: CONST ${v}`);
    continue;
  }
  const top = [...h.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  console.log(`  +${off}: VARIES distinct=${h.size}  ${top.map(([v,c])=>`${v}×${c}`).join("  ")}`);
}

// ---- Ground truth from descr_strat faction_relationships ----
// Format: faction_relationships  <factionA>,  <value>  <factionB>
// value <=199 => ally(<600 in matrix, expect 0); value >=201 => war (expect >=600); 200 = neutral
const stratTxt = fs.readFileSync(STRAT, "utf8");
const relRe = /^[^;]*faction_relationships\s+([a-z_0-9]+),?\s+(\d+)\s+([a-z_0-9]+)/;
const gtWar = [], gtAlly = [];
for (const line of stratTxt.split(/\r?\n/)) {
  const mm = line.match(relRe);
  if (!mm) continue;
  const a = mm[1], val = parseInt(mm[2],10), b = mm[3];
  if (val >= 201) gtWar.push([a, b, val]);
  else if (val <= 199) gtAlly.push([a, b, val]);
}
console.log(`\n=== GROUND TRUTH vs MATRIX (descr_strat faction_relationships) ===`);
console.log(`descr_strat declares: ${gtWar.length} war(>=201) + ${gtAlly.length} ally(<=199) pairs`);

function check(pairs, predicate, label) {
  let hit = 0, notInOrder = 0; const miss = [];
  for (const [a, b, val] of pairs) {
    const A = idxOf(a), B = idxOf(b);
    if (A < 0 || B < 0) { notInOrder++; continue; }
    const v = attOf(A, B);
    if (predicate(v)) hit++; else miss.push(`${a}<->${b} decl=${val} matrix=${v}`);
  }
  const tested = pairs.length - notInOrder;
  console.log(`${label}: ${hit}/${tested} matched (${notInOrder} factions not in order list)`);
  if (miss.length) console.log(`  MISS (first 15): ${miss.slice(0,15).join(" | ")}`);
  return { hit, tested };
}
check(gtWar, v => v >= 600, "WAR (expect matrix>=600)");
check(gtAlly, v => v < 200, "ALLY (expect matrix<200, i.e. 0)");

// ---- Symmetry across whole matrix ----
let sym = 0, tot = 0;
for (let A = 0; A < N; A++) for (let B = A+1; B < N; B++) { const v1 = attOf(A,B), v2 = attOf(B,A); tot++; if (v1===v2) sym++; }
console.log(`\nFull-matrix symmetry: ${sym}/${tot} (${(100*sym/tot).toFixed(2)}%)`);

// ---- counter (+20) & aggression (+24) cross-tab with attitude (+12) ----
console.log(`\n=== EXTRA FIELDS cross-tab with attitude (+12) ===`);
const xt = new Map(); // "att|counter|aggr" -> count
for (let i = 0; i < validCells; i++) {
  const o = m.cellStart + i * m.stride;
  const att = buf.readUInt32LE(o+12), cnt = buf.readUInt32LE(o+20), agg = buf.readUInt32LE(o+24);
  const k = `att=${att} counter=${cnt} aggr=${agg}`;
  xt.set(k, (xt.get(k)||0)+1);
}
[...xt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,c])=>console.log(`  ${k}  ×${c}`));
