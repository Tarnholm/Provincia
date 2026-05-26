// dig-script-fired-state-1.js
// GOAL: locate campaign-script runtime fired-state for one-time events.
// Hypothesis A: it all lives in the Lua persistent-counter zone (the *_Done /
//   *_flag / first_time_setup / *_PlayerRevolt counters).
// Method: dump the full Lua counter table from a T0 save and a later-turn save
//   of the SAME campaign, then DIFF. Counters that flip 0->non-0 between turns
//   are the fired-event flags.
//
// Research/diagnostics only. Does not modify app code.

const fs = require('fs');
const path = require('path');
const { findLuaCounters, indexCountersByName } = require('../../src/luaCounterParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';

// Same-campaign T0 -> T7 pair (the t0/t1.../t7 series).
const PAIRS = [
  ['save_t0.sav', 'save_t7.sav'],
  ['save_Seleucids t0.sav', 'save_Autosave   Seleucid Empire   Turn 1.sav'],
];

function loadCounters(file) {
  const buf = fs.readFileSync(path.join(BASE, file));
  const recs = findLuaCounters(buf);
  return { buf, recs, map: indexCountersByName(recs), size: buf.length };
}

// Counter-name patterns that, per RIS_Campaign_Script.txt, gate one-time events.
const FIRED_PATTERNS = [
  /_Done$/, /_flag$/i, /^first_time_setup$/, /_PlayerRevolt$/,
  /Owned$/, /Turns$/, /_setup$/, /reform/i, /Rebellion/i, /has_game_reloaded/,
];

function isFiredFlagName(n) {
  return FIRED_PATTERNS.some((re) => re.test(n));
}

for (const [a, b] of PAIRS) {
  console.log('\n==================================================================');
  console.log('PAIR:  EARLY =', a);
  console.log('       LATER =', b);
  console.log('==================================================================');

  let A, B;
  try { A = loadCounters(a); } catch (e) { console.log('  EARLY missing:', e.message); continue; }
  try { B = loadCounters(b); } catch (e) { console.log('  LATER missing:', e.message); continue; }

  console.log(`  EARLY size=${A.size}  counters=${A.recs.length}   table@0x${A.recs.length ? A.recs[0].offset.toString(16) : '?'}`);
  console.log(`  LATER size=${B.size}  counters=${B.recs.length}   table@0x${B.recs.length ? B.recs[0].offset.toString(16) : '?'}`);

  // turn_number sanity
  console.log(`  turn_number: EARLY=${A.map.get('turn_number')}  LATER=${B.map.get('turn_number')}`);

  // Build union of names.
  const names = new Set([...A.map.keys(), ...B.map.keys()]);

  // 1. Counters that CHANGED between the two saves.
  const changed = [];
  for (const n of names) {
    const va = A.map.has(n) ? A.map.get(n) : null;
    const vb = B.map.has(n) ? B.map.get(n) : null;
    if (va !== vb) changed.push({ n, va, vb });
  }
  changed.sort((x, y) => x.n.localeCompare(y.n));

  console.log(`\n  --- CHANGED counters (${changed.length}) [these encode runtime progress] ---`);
  for (const c of changed) {
    const tag = isFiredFlagName(c.n) ? '  <-- one-time-event/flag pattern' : '';
    console.log(`    ${c.n.padEnd(48)} ${String(c.va).padStart(12)} -> ${String(c.vb).padStart(12)}${tag}`);
  }

  // 2. New names that appeared only in LATER (table grew).
  const onlyLater = [...names].filter((n) => !A.map.has(n) && B.map.has(n)).sort();
  if (onlyLater.length) {
    console.log(`\n  --- counters present ONLY in LATER (${onlyLater.length}) ---`);
    for (const n of onlyLater) console.log(`    ${n.padEnd(48)} = ${B.map.get(n)}`);
  }
  const onlyEarly = [...names].filter((n) => A.map.has(n) && !B.map.has(n)).sort();
  if (onlyEarly.length) {
    console.log(`\n  --- counters present ONLY in EARLY (${onlyEarly.length}) ---`);
    for (const n of onlyEarly) console.log(`    ${n.padEnd(48)} = ${A.map.get(n)}`);
  }

  // 3. All fired-flag-pattern counters and their values in both, regardless of change.
  console.log('\n  --- ALL one-time/flag-pattern counters (value in EARLY | LATER) ---');
  const flagNames = [...names].filter(isFiredFlagName).sort();
  for (const n of flagNames) {
    const va = A.map.has(n) ? A.map.get(n) : '(absent)';
    const vb = B.map.has(n) ? B.map.get(n) : '(absent)';
    console.log(`    ${n.padEnd(48)} ${String(va).padStart(10)} | ${String(vb).padStart(10)}`);
  }
}
