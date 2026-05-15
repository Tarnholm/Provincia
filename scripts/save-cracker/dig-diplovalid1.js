// dig-diplovalid1.js — Session 49 cross-validate.
// Compare diplomacy matrix in save_1.2.sav (RIS imperial T1) against
// descr_strat.txt declared faction_relationships and core_attitudes.
//
// Approach:
//   1) Walk descr_sm_factions.txt to obtain ordered 239 faction names (top-level
//      blocks inside "factions": [ ... ]). Use brace-depth tracking.
//   2) Parse descr_strat.txt for active (non-comment) lines:
//        faction_relationships  <factionA>,  <value>  <factionB>
//        core_attitudes         <factionA>,  <value>  <factionB>
//      Build maps keyed on (idxA, idxB) where both factions exist in the 239.
//   3) Locate matrix start at 0xf8fd2 (verified hint). Read every cell [A][B].
//   4) Compare expected vs actual; bucket mismatches by type.

const fs = require('fs');
const path = require('path');

const SM_PATH = 'C:/RIS/RIS/data/descr_sm_factions.txt';
const DS_PATH = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
const SAVE_PATH = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';

const STRIDE = 267;
const N = 239;
const MAT_START = 0xf8fd2;

// ---- 1) Parse descr_sm_factions ordered list ----
function parseFactionList(text) {
  // Track brace depth from start; a top-level header inside "factions": [ ... ]
  // declares a faction. We treat depth 0 inside the factions array as the
  // place where faction names appear. Strategy:
  //   - Find the line containing '"factions":' then the next '['; that's depth 0.
  //   - Inside, track {} depth. At depth 0, any line matching ^\s*"<name>":
  //     (followed eventually by a '{') is a faction declaration.

  const factions = [];
  const lines = text.split(/\r?\n/);
  let inArr = false;
  let depth = 0;
  let pendingName = null;
  for (const raw of lines) {
    // strip inline comment starting with ';'
    const stripped = raw.replace(/;.*$/, '');
    if (!inArr) {
      if (/^"factions"\s*:/.test(stripped.trim())) {
        // next [ starts the array
        inArr = true;
        // if same line had '['
        if (stripped.includes('[')) {
          // We're now AT depth 0 of factions array
        }
      }
      continue;
    }
    // Count braces (ignoring leading '[' that started the array)
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    // Detect end of factions array (a ']' at depth 0)
    if (depth === 0 && /\]/.test(stripped)) {
      // could be end of array; but if there's a '"' name line earlier on same line, handle
      // We'll assume the array ends; break.
      // BUT some files have nested arrays; only break on a bare ']'
      if (/^\s*\]/.test(stripped)) break;
    }
    if (depth !== 0) continue;
    // At depth 0, a header "<name>": indicates a faction
    const m = stripped.match(/^\s*"([a-z_][a-z_0-9]*)"\s*:/);
    if (m) {
      pendingName = m[1];
      // Don't push yet; ensure a '{' eventually follows. But for robustness
      // just push immediately — every faction has braces.
      factions.push(pendingName);
    }
  }
  return factions;
}

const smText = fs.readFileSync(SM_PATH, 'utf8');
let factions = parseFactionList(smText);
console.log(`Parsed ${factions.length} factions from RIS descr_sm_factions.txt`);

if (factions.length !== N) {
  // Try Provincia public version (session 32 verified 239 here)
  const PROV_SM = 'C:/dev/Provincia/public/descr_sm_factions.txt';
  const provText = fs.readFileSync(PROV_SM, 'utf8');
  factions = parseFactionList(provText);
  console.log(`Fallback: parsed ${factions.length} factions from Provincia public descr_sm_factions.txt`);
}

if (factions.length !== N) {
  console.error(`!! Got ${factions.length}, expected ${N}. Aborting.`);
  process.exit(1);
}

const idxOf = new Map(factions.map((n, i) => [n, i]));
console.log(`romans_julii=${idxOf.get('romans_julii')} messapians=${idxOf.get('messapians')} taras=${idxOf.get('taras')} vettones=${idxOf.get('vettones')} slave=${idxOf.get('slave')}`);

// ---- 2) Parse descr_strat for active relationships ----
const dsText = fs.readFileSync(DS_PATH, 'utf8');
const dsLines = dsText.split(/\r?\n/);

const declRel = new Map();   // 'A|B' -> value (faction_relationships)
const declAtt = new Map();   // 'A|B' -> attitudes value
const unknownTokens = new Set();

let relTotal = 0, relInList = 0, attTotal = 0, attInList = 0;

for (let ln = 0; ln < dsLines.length; ln++) {
  let line = dsLines[ln];
  // strip comments at first ';' that's not inside a string
  const semi = line.indexOf(';');
  if (semi >= 0) line = line.slice(0, semi);
  line = line.trim();
  if (!line) continue;
  // Recognize:
  //   faction_relationships  factionA,  value  factionB
  //   core_attitudes         factionA,  value  factionB
  // Tokens separated by commas / whitespace.
  let m = line.match(/^(faction_relationships|core_attitudes)\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/);
  if (!m) continue;
  const [, kind, a, vStr, b] = m;
  const v = parseInt(vStr, 10);
  const ia = idxOf.get(a);
  const ib = idxOf.get(b);
  if (kind === 'faction_relationships') {
    relTotal++;
    if (ia == null) unknownTokens.add(a);
    if (ib == null) unknownTokens.add(b);
    if (ia != null && ib != null) {
      relInList++;
      const key = `${ia}|${ib}`;
      // If duplicate, keep latest (descr_strat seems sequential)
      declRel.set(key, v);
    }
  } else {
    attTotal++;
    if (ia == null) unknownTokens.add(a);
    if (ib == null) unknownTokens.add(b);
    if (ia != null && ib != null) {
      attInList++;
      const key = `${ia}|${ib}`;
      declAtt.set(key, v);
    }
  }
}

console.log(`faction_relationships: ${relTotal} active lines (${relInList} both-in-239); core_attitudes: ${attTotal} (${attInList} both-in-239)`);
console.log(`Unknown tokens (not in 239 list): ${[...unknownTokens].slice(0,30).join(', ')}${unknownTokens.size>30?', ...':''}  (total=${unknownTokens.size})`);

// ---- 3) Read save matrix ----
const buf = fs.readFileSync(SAVE_PATH);
console.log(`Loaded save ${SAVE_PATH} size=${buf.length} (=0x${buf.length.toString(16)})`);

function cellOff(r, c) { return MAT_START + (r * N + c) * STRIDE; }
function readCell(r, c) {
  const o = cellOff(r, c);
  return {
    prev: buf.readInt32LE(o + 0),
    curr: buf.readInt32LE(o + 4),
    u8:   buf.readInt32LE(o + 8),
    u12:  buf.readInt32LE(o + 12),
    u16:  buf.readInt32LE(o + 16),
    u20:  buf.readInt32LE(o + 20),
    u24:  buf.readInt32LE(o + 24),
    u28:  buf.readInt32LE(o + 28),
    u32:  buf.readInt32LE(o + 32),
  };
}

// Sanity check matrix start
const sample = readCell(0, 0);
console.log(`[0][0]: prev=${sample.prev} curr=${sample.curr} u12=${sample.u12} u16=${sample.u16}`);
if (sample.u12 !== 10) console.warn('!! u12 != 10, matStart may be wrong');

// ---- 4) Compare ----
// descr_strat faction_relationships value semantics (from the file header comments):
//   <=199 = Ally (+ trade agreement if possible)   "Allied"
//   200   = Neutral
//   >=201 = War
//
// Session 32-34 confirmed matrix encoding:
//   prev=5, curr=0 = default/never-met
//   prev=0, curr=1 = active relationship (trade rights / alliance)
//   prev=0, curr=-1 = recent rejection
//   War: prev/curr unchanged from (5,0); +8 field signed delta
//   +20/+32: descr_strat-derived bilateral opinion {0,200,400,600,-10}
//
// At turn 1, +8 = 0 for everyone (no in-game actions yet) by hypothesis;
// +20/+32 encode the static descr_strat opinion. Let's verify:
//   - core_attitudes values from descr_strat go into +20 / +32 directly?
//     (or scaled? session 33 said quantized 0/200/600 axes)
//   - declared war (faction_relationships >=201) might show as +8 != 0 OR
//     as a different default cell state.

// Strategy: classify each declared pair into expected category, then bin actuals.

function classifyDecl(v) {
  if (v <= 199) return 'ally';     // <=199
  if (v === 200) return 'neutral'; // exact 200
  return 'war';                    // >=201
}

// Build expected map: pair key -> category
const expected = new Map();
for (const [k, v] of declRel) {
  expected.set(k, { cat: classifyDecl(v), v });
}

// Bucket results
const buckets = {
  'ally:default(5,0)':       [],
  'ally:active(0,1)':        [],
  'ally:other':              [],
  'neutral:default(5,0)':    [],
  'neutral:other':           [],
  'war:default(5,0)+8neg':   [],
  'war:default(5,0)+8zero':  [],
  'war:other':               [],
};

function cellTag(c) {
  if (c.prev === 5 && c.curr === 0) return c.u8 < 0 ? 'default(5,0)+8neg' : 'default(5,0)+8zero';
  if (c.prev === 0 && c.curr === 1) return 'active(0,1)';
  if (c.prev === 0 && c.curr === -1) return 'reject(0,-1)';
  return `other(${c.prev},${c.curr})`;
}

let totalDecl = 0;
const mismatchSamples = { ally: [], neutral: [], war: [] };
const allRows = [];

for (const [key, exp] of expected) {
  totalDecl++;
  const [ra, rb] = key.split('|').map(Number);
  const c1 = readCell(ra, rb);
  const c2 = readCell(rb, ra);
  const t1 = cellTag(c1), t2 = cellTag(c2);
  const tag = `${exp.cat}:${t1}`;
  if (buckets[tag] == null) buckets[tag] = [];
  buckets[tag].push({ a: factions[ra], b: factions[rb], v: exp.v, c1, c2 });
  allRows.push({ key, exp, t1, t2, c1, c2 });

  // Track interesting mismatches per category for sampling
  if (exp.cat === 'ally' && !(c1.prev === 0 && c1.curr === 1)) {
    if (mismatchSamples.ally.length < 8) mismatchSamples.ally.push({a:factions[ra],b:factions[rb],v:exp.v,c1,c2});
  }
  if (exp.cat === 'war' && c1.u8 >= 0) {
    if (mismatchSamples.war.length < 8) mismatchSamples.war.push({a:factions[ra],b:factions[rb],v:exp.v,c1,c2});
  }
}

console.log('\n=== Declared pair counts ===');
console.log(`Total declared (both in 239): ${totalDecl}`);
const catCount = { ally:0, neutral:0, war:0 };
for (const [, e] of expected) catCount[e.cat]++;
console.log(catCount);

console.log('\n=== Bucket counts (expected:actual) ===');
const sortedTags = Object.keys(buckets).sort();
for (const t of sortedTags) {
  if (buckets[t].length === 0) continue;
  console.log(`  ${t}: ${buckets[t].length}`);
}

// Also tabulate by (cat, c1.prev, c1.curr, sign(c1.u8))
const cross = new Map();
for (const r of allRows) {
  const k = `${r.exp.cat}|prev=${r.c1.prev},curr=${r.c1.curr},u8sign=${Math.sign(r.c1.u8)}`;
  cross.set(k, (cross.get(k)||0)+1);
}
console.log('\n=== cat × (prev,curr,sign(u8)) ===');
for (const [k,v] of [...cross.entries()].sort()) console.log(`  ${k}: ${v}`);

// Sample mismatch rows
console.log('\n=== Sample ally rows where cell is NOT (0,1) ===');
for (const m of mismatchSamples.ally) {
  console.log(`  ${m.a} (idx=${idxOf.get(m.a)}) ↔ ${m.b} (idx=${idxOf.get(m.b)}) decl_v=${m.v}  c1: prev=${m.c1.prev} curr=${m.c1.curr} +8=${m.c1.u8} +20=${m.c1.u20} +32=${m.c1.u32}  c2: prev=${m.c2.prev} curr=${m.c2.curr} +8=${m.c2.u8}`);
}
console.log('\n=== Sample war rows where cell +8 >= 0 ===');
for (const m of mismatchSamples.war) {
  console.log(`  ${m.a} (idx=${idxOf.get(m.a)}) ↔ ${m.b} (idx=${idxOf.get(m.b)}) decl_v=${m.v}  c1: prev=${m.c1.prev} curr=${m.c1.curr} +8=${m.c1.u8} +20=${m.c1.u20} +32=${m.c1.u32}  c2: prev=${m.c2.prev} curr=${m.c2.curr} +8=${m.c2.u8}`);
}

// Also see what the matrix actually contains for the known war pairs
console.log('\n=== All war-declared cells: distribution of +8 / +20 / +32 ===');
const warStats = { u8: new Map(), u20: new Map(), u32: new Map() };
for (const r of allRows) {
  if (r.exp.cat !== 'war') continue;
  warStats.u8.set(r.c1.u8, (warStats.u8.get(r.c1.u8)||0)+1);
  warStats.u20.set(r.c1.u20, (warStats.u20.get(r.c1.u20)||0)+1);
  warStats.u32.set(r.c1.u32, (warStats.u32.get(r.c1.u32)||0)+1);
}
for (const k of ['u8','u20','u32']) {
  console.log(`  ${k}: ${[...warStats[k].entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v,c])=>`${v}×${c}`).join(' ')}`);
}

console.log('\n=== All ally-declared cells: distribution of +20 / +32 / prev / curr ===');
const allyStats = { prevcurr: new Map(), u20: new Map(), u32: new Map() };
for (const r of allRows) {
  if (r.exp.cat !== 'ally') continue;
  allyStats.prevcurr.set(`${r.c1.prev},${r.c1.curr}`, (allyStats.prevcurr.get(`${r.c1.prev},${r.c1.curr}`)||0)+1);
  allyStats.u20.set(r.c1.u20, (allyStats.u20.get(r.c1.u20)||0)+1);
  allyStats.u32.set(r.c1.u32, (allyStats.u32.get(r.c1.u32)||0)+1);
}
for (const k of ['prevcurr','u20','u32']) {
  console.log(`  ${k}: ${[...allyStats[k].entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([v,c])=>`${v}×${c}`).join(' ')}`);
}

// Also probe core_attitudes (these should map to +20/+32 specifically)
console.log('\n=== core_attitudes value × matrix +20 distribution ===');
const attCross = new Map();
for (const [k, v] of declAtt) {
  const [ra, rb] = k.split('|').map(Number);
  const c = readCell(ra, rb);
  const ck = `att=${v} → +20=${c.u20}, +32=${c.u32}`;
  attCross.set(ck, (attCross.get(ck)||0)+1);
}
for (const [k,v] of [...attCross.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20)) {
  console.log(`  ${k}: ×${v}`);
}
