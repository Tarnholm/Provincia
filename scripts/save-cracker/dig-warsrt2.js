// dig-warsrt2.js - Session 51 attempt 2 (FINAL).
//
// Attempt 1 finding: att>=600 has recall=1.0 (all 238 war pairs have it) but
// precision=0.63 (140 non-war pairs ALSO have att=600). So pure attitude
// threshold can NOT reconstruct war state — wars need an additional signal.
//
// Test 2 candidate rules:
//   R1: max(att) >= 600 AND no `faction_relationships <= 200` declaration
//       (i.e., att=600 means war UNLESS overridden by a non-war rel line)
//   R2: BOTH directed atts (A->B and B->A) are >= 600 (mutual hostility)
//   R3: rel-line directly: war iff faction_relationships value >= 201
//       (trivial; serves as oracle baseline)
//
// Also: check directedness of core_attitudes. If 9/10 pairs have only ONE
// declared direction, the "max" rule is fragile.

const fs = require('fs');

const SM_PATH = 'C:/RIS/RIS/data/descr_sm_factions.txt';
const DS_PATH = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';

const N = 239;

function parseFactionList(text) {
  const factions = [];
  const lines = text.split(/\r?\n/);
  let inArr = false, depth = 0;
  for (const raw of lines) {
    const stripped = raw.replace(/;.*$/, '');
    if (!inArr) { if (/^"factions"\s*:/.test(stripped.trim())) inArr = true; continue; }
    for (const ch of stripped) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth === 0 && /^\s*\]/.test(stripped)) break;
    if (depth !== 0) continue;
    const m = stripped.match(/^\s*"([a-z_][a-z_0-9]*)"\s*:/);
    if (m) factions.push(m[1]);
  }
  return factions;
}

let smText;
try { smText = fs.readFileSync(SM_PATH, 'utf8'); } catch { smText = fs.readFileSync('C:/dev/Provincia/public/descr_sm_factions.txt', 'utf8'); }
let factions = parseFactionList(smText);
if (factions.length !== N) factions = parseFactionList(fs.readFileSync('C:/dev/Provincia/public/descr_sm_factions.txt', 'utf8'));
const idxOf = new Map(factions.map((n, i) => [n, i]));

const dsText = fs.readFileSync(DS_PATH, 'utf8');

// Directed maps for each declaration type
const relDirected = new Map();   // 'a->b' -> value
const attDirected = new Map();   // 'a->b' -> value

for (const raw of dsText.split(/\r?\n/)) {
  const semi = raw.indexOf(';');
  let line = semi >= 0 ? raw.slice(0, semi) : raw;
  line = line.replace(/^[\s\t]+/, '');
  if (!line) continue;
  let m;
  if ((m = line.match(/^faction_relationships\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/))) {
    const ia = idxOf.get(m[1]); const ib = idxOf.get(m[3]); if (ia == null || ib == null) continue;
    relDirected.set(`${ia}->${ib}`, parseInt(m[2], 10));
  } else if ((m = line.match(/^core_attitudes\s+([a-z_][a-z_0-9]*)\s*,?\s+(-?\d+)\s+([a-z_][a-z_0-9]*)/))) {
    const ia = idxOf.get(m[1]); const ib = idxOf.get(m[3]); if (ia == null || ib == null) continue;
    attDirected.set(`${ia}->${ib}`, parseInt(m[2], 10));
  }
}
console.log(`Parsed ${relDirected.size} directed rel lines, ${attDirected.size} directed att lines`);

// ---- Check directedness of core_attitudes ----
function uk(a,b){return a<b?`${a}|${b}`:`${b}|${a}`;}
const attCountByUk = new Map();
for (const k of attDirected.keys()) {
  const [a, b] = k.split('->').map(Number);
  const key = uk(a, b);
  attCountByUk.set(key, (attCountByUk.get(key) || 0) + 1);
}
let bothDirs = 0, oneDir = 0;
for (const c of attCountByUk.values()) {
  if (c === 2) bothDirs++; else if (c === 1) oneDir++;
}
console.log(`core_attitudes directedness: ${bothDirs} pairs declared BOTH ways, ${oneDir} pairs declared ONE way only`);

// ---- Build classified pairs (unordered) ----
const warPairsU = new Set(), allyPairsU = new Set(), neutralPairsU = new Set(), otherRelU = new Set();
for (const [k, v] of relDirected) {
  const [a, b] = k.split('->').map(Number);
  const key = uk(a, b);
  if (v >= 201) warPairsU.add(key);
  else if (v === 199) allyPairsU.add(key);
  else if (v === 200) neutralPairsU.add(key);
  else otherRelU.add(key);
}
console.log(`Unordered: WAR=${warPairsU.size}, ALLY=${allyPairsU.size}, NEUTRAL=${neutralPairsU.size}, OTHER-rel=${otherRelU.size}`);

// max-att lookup
const attMaxByUk = new Map();
const attMinByUk = new Map();
for (const [k, v] of attDirected) {
  const [a, b] = k.split('->').map(Number);
  const key = uk(a, b);
  attMaxByUk.set(key, attMaxByUk.has(key) ? Math.max(attMaxByUk.get(key), v) : v);
  attMinByUk.set(key, attMinByUk.has(key) ? Math.min(attMinByUk.get(key), v) : v);
}

// All classified unordered pairs (rel ∪ att)
const allPairs = new Set();
for (const k of relDirected.keys()) { const [a, b] = k.split('->').map(Number); allPairs.add(uk(a, b)); }
for (const k of attDirected.keys()) { const [a, b] = k.split('->').map(Number); allPairs.add(uk(a, b)); }
console.log(`Total unique unordered pairs declared: ${allPairs.size}`);

// ---- R1: max(att)>=600 AND no rel-line says <=200 ----
console.log('\n=== R1: war iff attMax >= 600 AND no faction_relationships<=200 declaration ===');
{
  let TP=0, FP=0, FN=0, TN=0;
  const FPex = [], FNex = [];
  for (const key of allPairs) {
    const v = attMaxByUk.get(key);
    const hasNonWarRel = allyPairsU.has(key) || neutralPairsU.has(key) || otherRelU.has(key);
    const pred = v != null && v >= 600 && !hasNonWarRel;
    const actual = warPairsU.has(key);
    if (pred && actual) TP++;
    else if (pred && !actual) { FP++; if (FPex.length<8) { const [a,b]=key.split('|').map(Number); FPex.push(`${factions[a]}<->${factions[b]} attMax=${v}`); } }
    else if (!pred && actual) { FN++; if (FNex.length<8) { const [a,b]=key.split('|').map(Number); FNex.push(`${factions[a]}<->${factions[b]} attMax=${v} hasRel=${hasNonWarRel}`); } }
    else TN++;
  }
  const recall=TP/(TP+FN||1), precision=TP/(TP+FP||1), f1=2*recall*precision/(recall+precision||1);
  console.log(`TP=${TP} FP=${FP} FN=${FN} TN=${TN} | recall=${recall.toFixed(3)} precision=${precision.toFixed(3)} F1=${f1.toFixed(3)}`);
  console.log('FP examples (predicted war, not declared):'); FPex.forEach(s=>console.log('  '+s));
  console.log('FN examples (declared war, not predicted):'); FNex.forEach(s=>console.log('  '+s));
}

// ---- R2: BOTH directions att>=600 ----
console.log('\n=== R2: war iff BOTH directed attitudes >= 600 (mutual hostility) ===');
{
  let TP=0, FP=0, FN=0, TN=0;
  const FPex = [], FNex = [];
  for (const key of allPairs) {
    const [a, b] = key.split('|').map(Number);
    const v1 = attDirected.get(`${a}->${b}`);
    const v2 = attDirected.get(`${b}->${a}`);
    const pred = v1 != null && v2 != null && v1 >= 600 && v2 >= 600;
    const actual = warPairsU.has(key);
    if (pred && actual) TP++;
    else if (pred && !actual) { FP++; if (FPex.length<8) FPex.push(`${factions[a]}<->${factions[b]} ${v1}/${v2}`); }
    else if (!pred && actual) { FN++; if (FNex.length<8) FNex.push(`${factions[a]}<->${factions[b]} ${v1}/${v2}`); }
    else TN++;
  }
  const recall=TP/(TP+FN||1), precision=TP/(TP+FP||1), f1=2*recall*precision/(recall+precision||1);
  console.log(`TP=${TP} FP=${FP} FN=${FN} TN=${TN} | recall=${recall.toFixed(3)} precision=${precision.toFixed(3)} F1=${f1.toFixed(3)}`);
  console.log('FP examples:'); FPex.forEach(s=>console.log('  '+s));
  console.log('FN examples:'); FNex.forEach(s=>console.log('  '+s));
}

// ---- R3: min(att) >= 600 ----
console.log('\n=== R3: war iff attMin >= 600 (most conservative attitude-only) ===');
{
  let TP=0, FP=0, FN=0;
  for (const key of allPairs) {
    const vmin = attMinByUk.get(key);
    const pred = vmin != null && vmin >= 600;
    const actual = warPairsU.has(key);
    if (pred && actual) TP++;
    else if (pred && !actual) FP++;
    else if (!pred && actual) FN++;
  }
  const recall=TP/(TP+FN||1), precision=TP/(TP+FP||1), f1=2*recall*precision/(recall+precision||1);
  console.log(`TP=${TP} FP=${FP} FN=${FN} | recall=${recall.toFixed(3)} precision=${precision.toFixed(3)} F1=${f1.toFixed(3)}`);
}

// ---- Distribution: for each WAR pair, is the att declaration symmetric? ----
console.log('\n--- Symmetry of attitudes within WAR pairs ---');
{
  let bothDir=0, oneDir=0, none=0;
  for (const key of warPairsU) {
    const c = attCountByUk.get(key) || 0;
    if (c === 2) bothDir++; else if (c === 1) oneDir++; else none++;
  }
  console.log(`WAR pairs: BOTH-dir-att=${bothDir}, ONE-dir-att=${oneDir}, NO-att=${none}`);
}
console.log('\n--- Symmetry of attitudes within ALLY pairs ---');
{
  let bothDir=0, oneDir=0, none=0;
  for (const key of allyPairsU) {
    const c = attCountByUk.get(key) || 0;
    if (c === 2) bothDir++; else if (c === 1) oneDir++; else none++;
  }
  console.log(`ALLY pairs: BOTH-dir-att=${bothDir}, ONE-dir-att=${oneDir}, NO-att=${none}`);
}

// ---- Summary takeaway ----
console.log('\n--- Verdict ---');
console.log('R1 (att>=600 AND no non-war rel-line) is the cleanest non-trivial reconstructor.');
console.log('If R1 is ~100% accurate, the engine can rebuild war state at runtime from descr_strat alone,');
console.log('and wars do NOT need their own save-file decode (separate from the rel-line text).');
