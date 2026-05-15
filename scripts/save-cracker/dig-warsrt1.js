// dig-warsrt1.js - Session 51 attempt 1.
//
// HYPOTHESIS: starting wars are NOT stored in save_1.2 at all; the engine
// derives war-state at runtime from core_attitudes >= some_threshold.
//
// Method:
//   1. Parse descr_strat.txt: extract every faction_relationships pair
//      classed as WAR (>=201), ALLY (=199), NEUTRAL (=200), and every
//      core_attitudes A B value declaration.
//   2. For each (A,B) pair in the war/ally/neutral sets, look up the
//      declared core_attitudes value for that pair (either direction).
//   3. Histogram: distribution of declared core_attitudes per relationship
//      class. If wars cluster at 600 and allies at 0/-10 and neutrals are
//      mixed, then the runtime rule could be: war iff core_att >= X.
//   4. Cross-check against the save: cells where (prev,curr,+8) DIFFER
//      from (5,0,0) at turn 1 — what relationships do they correspond to?
//
// Hard early-stop: 2 attempts.

const fs = require('fs');
const path = require('path');

const SM_PATH = 'C:/RIS/RIS/data/descr_sm_factions.txt';
const DS_PATH = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SAVE_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';

const N = 239;
const MATRIX_BASE = 0xf8fd2;  // confirmed session 49

// ---- Parse faction list ----
function parseFactionList(text) {
  const factions = [];
  const lines = text.split(/\r?\n/);
  let inArr = false;
  let depth = 0;
  for (const raw of lines) {
    const stripped = raw.replace(/;.*$/, '');
    if (!inArr) {
      if (/^"factions"\s*:/.test(stripped.trim())) inArr = true;
      continue;
    }
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && /^\s*\]/.test(stripped)) break;
    if (depth !== 0) continue;
    const m = stripped.match(/^\s*"([a-z_][a-z_0-9]*)"\s*:/);
    if (m) factions.push(m[1]);
  }
  return factions;
}

let smText;
try { smText = fs.readFileSync(SM_PATH, 'utf8'); }
catch { smText = fs.readFileSync('C:/dev/Provincia/public/descr_sm_factions.txt', 'utf8'); }
let factions = parseFactionList(smText);
if (factions.length !== N) {
  factions = parseFactionList(fs.readFileSync('C:/dev/Provincia/public/descr_sm_factions.txt', 'utf8'));
}
if (factions.length !== N) { console.error(`Got ${factions.length}, want ${N}`); process.exit(1); }
const idxOf = new Map(factions.map((n, i) => [n, i]));
console.log(`Parsed ${factions.length} factions.`);

// ---- Parse descr_strat ----
// Lines look like:
//   <whitespace>faction_relationships<ws>NAME,<ws>NUM<ws>NAME
//   <whitespace>core_attitudes<ws>NAME,<ws>NUM<ws>NAME
// Number can be -10, 0, 199, 200, 201, 250, 300, 400, 600.
const dsText = fs.readFileSync(DS_PATH, 'utf8');

const relPairs = [];   // {a, b, value}
const attPairs = [];   // {a, b, value}

for (const raw of dsText.split(/\r?\n/)) {
  const semi = raw.indexOf(';');
  let line = semi >= 0 ? raw.slice(0, semi) : raw;
  // Don't trim leading whitespace yet — but we want to allow it (brief: 1109 attitudes, 432 rels).
  line = line.replace(/^[\s\t]+/, '');
  if (!line) continue;

  let m;
  if ((m = line.match(/^faction_relationships\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/))) {
    const ia = idxOf.get(m[1]);
    const ib = idxOf.get(m[3]);
    if (ia == null || ib == null) continue;
    relPairs.push({ a: ia, b: ib, value: parseInt(m[2], 10) });
  } else if ((m = line.match(/^core_attitudes\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/))) {
    const ia = idxOf.get(m[1]);
    const ib = idxOf.get(m[3]);
    if (ia == null || ib == null) continue;
    attPairs.push({ a: ia, b: ib, value: parseInt(m[2], 10) });
  }
}
console.log(`Parsed ${relPairs.length} faction_relationships lines, ${attPairs.length} core_attitudes lines`);

// Classify relationships
const warPairs = new Set();     // unordered key 'min|max'
const allyPairs = new Set();    // value === 199 -> ally
const neutralPairs = new Set(); // value === 200 -> neutral (rare)
function uk(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
for (const { a, b, value } of relPairs) {
  const key = uk(a, b);
  if (value >= 201) warPairs.add(key);
  else if (value === 199) allyPairs.add(key);
  else if (value === 200) neutralPairs.add(key);
  // else (e.g., 1, 75, 100, 150, 175) — shouldn't appear in RIS imperial
  // but if it does, treat as "other"
}
console.log(`WAR pairs: ${warPairs.size}, ALLY pairs: ${allyPairs.size}, NEUTRAL pairs: ${neutralPairs.size}`);

// Build unordered attitude lookup. core_attitudes is DIRECTED:
// `A B value` means A's opinion of B (or symmetric?). We treat as undirected
// by taking the MAX of any directed declarations for the unordered key
// (since wars need only one side feeling hostile).
const attMaxByKey = new Map();
const attDirected = new Map();  // key 'a->b'
const attSymBoth = new Map();   // 'min|max' -> [valuesFromBothDirections]
for (const { a, b, value } of attPairs) {
  const k = uk(a, b);
  const cur = attMaxByKey.get(k);
  attMaxByKey.set(k, cur == null ? value : Math.max(cur, value));
  attDirected.set(`${a}->${b}`, value);
  if (!attSymBoth.has(k)) attSymBoth.set(k, []);
  attSymBoth.get(k).push(value);
}
console.log(`Unique unordered pairs with at least one core_attitudes declaration: ${attMaxByKey.size}`);

// ---- Histogram of attitudes per relationship class ----
function histogram(pairSet, label) {
  const hist = new Map();   // attitude -> count
  let withAtt = 0, noAtt = 0;
  for (const key of pairSet) {
    const v = attMaxByKey.get(key);
    if (v == null) {
      noAtt++;
      hist.set('NONE', (hist.get('NONE') || 0) + 1);
    } else {
      withAtt++;
      hist.set(v, (hist.get(v) || 0) + 1);
    }
  }
  console.log(`\n${label} (n=${pairSet.size}): with-attitude=${withAtt}, no-attitude=${noAtt}`);
  const entries = [...hist.entries()].sort((a, b) => {
    if (a[0] === 'NONE') return 1;
    if (b[0] === 'NONE') return -1;
    return a[0] - b[0];
  });
  for (const [v, c] of entries) {
    const pct = ((c / pairSet.size) * 100).toFixed(1);
    console.log(`  att=${v}: ${c}  (${pct}%)`);
  }
  return hist;
}

const histWar = histogram(warPairs, 'WAR');
const histAlly = histogram(allyPairs, 'ALLY');
const histNeutral = histogram(neutralPairs, 'NEUTRAL');

// "All other unordered pairs" — pairs with attitudes but no relationship line
const otherPairs = new Set();
for (const key of attMaxByKey.keys()) {
  if (warPairs.has(key) || allyPairs.has(key) || neutralPairs.has(key)) continue;
  otherPairs.add(key);
}
const histOther = histogram(otherPairs, 'OTHER (att declared, no rel line)');

// ---- Build full universe of all unordered pairs that have either a rel or att declaration ----
const allClassifiedPairs = new Set([...warPairs, ...allyPairs, ...neutralPairs, ...otherPairs]);
console.log(`\nTotal classified pairs (rel ∪ att): ${allClassifiedPairs.size}`);

// ---- Compute clean threshold X such that: war iff max(coreAtt) >= X ----
console.log('\n--- Threshold sweep (pred: war iff attMax >= X) ---');
console.log('X     | TP    FP    FN    TN    | recall  precision  F1');
const candidates = [-10, 0, 200, 400, 500, 600, 601];
for (const X of candidates) {
  let TP = 0, FP = 0, FN = 0, TN = 0;
  for (const key of allClassifiedPairs) {
    const v = attMaxByKey.get(key);
    const pred = v != null && v >= X;
    const actual = warPairs.has(key);
    if (pred && actual) TP++;
    else if (pred && !actual) FP++;
    else if (!pred && actual) FN++;
    else TN++;
  }
  const recall = TP / (TP + FN || 1);
  const precision = TP / (TP + FP || 1);
  const f1 = 2 * recall * precision / (recall + precision || 1);
  console.log(`${X.toString().padStart(5)} | ${TP.toString().padStart(5)} ${FP.toString().padStart(5)} ${FN.toString().padStart(5)} ${TN.toString().padStart(5)} | ${recall.toFixed(3)}    ${precision.toFixed(3)}      ${f1.toFixed(3)}`);
}

// ---- Cross-check vs save: where (prev,curr,+8) differs from (5,0,0), what's the rel? ----
const buf = fs.readFileSync(SAVE_PATH);
console.log(`\nLoaded save size=${buf.length} (0x${buf.length.toString(16)})`);

// session 32-34 matrix layout: row-major NxN, 64 bytes per cell.
// (prev,curr,+8) at offsets 0,4,8 within each 64-byte cell.
const CELL = 64;
let nonDefaultCells = 0;
const nonDefaultByClass = { war: 0, ally: 0, neutral: 0, other: 0, noClass: 0 };
const nonDefaultExamples = [];
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    if (i === j) continue;
    const off = MATRIX_BASE + (i * N + j) * CELL;
    if (off + 12 > buf.length) continue;
    const prev = buf.readInt32LE(off + 0);
    const curr = buf.readInt32LE(off + 4);
    const plus8 = buf.readInt32LE(off + 8);
    if (prev === 5 && curr === 0 && plus8 === 0) continue;
    nonDefaultCells++;
    const key = uk(i, j);
    let cls = 'noClass';
    if (warPairs.has(key)) cls = 'war';
    else if (allyPairs.has(key)) cls = 'ally';
    else if (neutralPairs.has(key)) cls = 'neutral';
    else if (otherPairs.has(key)) cls = 'other';
    nonDefaultByClass[cls]++;
    if (nonDefaultExamples.length < 30) {
      nonDefaultExamples.push({ i, j, prev, curr, plus8, cls,
        a: factions[i], b: factions[j],
        att: attDirected.get(`${i}->${j}`) ?? attDirected.get(`${j}->${i}`) });
    }
  }
}
console.log(`\nCells with (prev,curr,+8) != (5,0,0): ${nonDefaultCells}`);
console.log('Class breakdown:', JSON.stringify(nonDefaultByClass));
console.log('\nExamples:');
for (const e of nonDefaultExamples) {
  console.log(`  (${e.i},${e.j}) ${e.a} -> ${e.b}: prev=${e.prev} curr=${e.curr} +8=${e.plus8} cls=${e.cls} att=${e.att}`);
}

// ---- Pin candidate threshold: print confusion for X=600 strictly, X=400 ----
// and check whether a 2-cls split (war vs not) is clean
console.log('\n--- War-vs-not separation at X=600 (max-att rule) ---');
{
  const X = 600;
  let TP = 0, FP = 0, FN = 0;
  const FPexamples = [], FNexamples = [];
  for (const key of warPairs) {
    const v = attMaxByKey.get(key);
    if (v != null && v >= X) TP++;
    else {
      FN++;
      if (FNexamples.length < 10) {
        const [ai, bi] = key.split('|').map(Number);
        FNexamples.push(`${factions[ai]} <-> ${factions[bi]} att=${v}`);
      }
    }
  }
  // For FP, check non-war pairs that have att>=X
  for (const key of allyPairs) {
    const v = attMaxByKey.get(key);
    if (v != null && v >= X) { FP++; if (FPexamples.length < 10) { const [ai, bi] = key.split('|').map(Number); FPexamples.push(`ALLY ${factions[ai]} <-> ${factions[bi]} att=${v}`); } }
  }
  for (const key of neutralPairs) {
    const v = attMaxByKey.get(key);
    if (v != null && v >= X) { FP++; if (FPexamples.length < 10) { const [ai, bi] = key.split('|').map(Number); FPexamples.push(`NEUTRAL ${factions[ai]} <-> ${factions[bi]} att=${v}`); } }
  }
  for (const key of otherPairs) {
    const v = attMaxByKey.get(key);
    if (v != null && v >= X) { FP++; if (FPexamples.length < 10) { const [ai, bi] = key.split('|').map(Number); FPexamples.push(`OTHER ${factions[ai]} <-> ${factions[bi]} att=${v}`); } }
  }
  console.log(`X=600: TP=${TP} FP=${FP} FN=${FN}`);
  console.log('FN examples (declared war but max-att < 600):');
  FNexamples.forEach(s => console.log('  ' + s));
  console.log('FP examples (max-att >= 600 but not declared war):');
  FPexamples.forEach(s => console.log('  ' + s));
}
