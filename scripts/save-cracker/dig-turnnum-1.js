// dig-turnnum-1.js — Session 104
//
// Pin the semantics of the Lua counter "turn_number" in the player faction
// record, and locate the absolute turn in the save header.
//
// Plan:
//  1. Enumerate Lua counters in every available save (player record's Lua
//     zone at +0x04bb50 onwards).
//  2. Tabulate "turn_number" + any other turn-ish counters across saves.
//  3. Read the header turn at u32 LE offset 3968 (from main.js
//     readTurnFromSave: turnCounter + 1 = displayed turn) and year at int32
//     LE offset 3972 (readCurrentYearFromSave).
//  4. Diff every counter across saves and surface the top-20 most-dynamic.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

// ---- Header readers (mirror of main.js readTurnFromSave / readCurrentYearFromSave) ----
function readHeaderTurn(buf) {
  if (buf.length < 3972) return null;
  const v = buf.readUInt32LE(3968);
  if (v > 10000) return null;
  return v + 1;
}
function readHeaderYear(buf) {
  if (buf.length < 3976) return null;
  const y = buf.readInt32LE(3972);
  if (y < -2000 || y > 3000) return null;
  return y;
}
function readHeaderRaw(buf) {
  // raw fields at the same offsets — return the underlying u32/i32 too
  if (buf.length < 3976) return null;
  return {
    u32_3968: buf.readUInt32LE(3968),
    i32_3968: buf.readInt32LE(3968),
    i32_3972: buf.readInt32LE(3972),
    // bracket — show 16 bytes around the header turn block
    hex: [...buf.slice(3960, 3984)].map(b => b.toString(16).padStart(2, '0')).join(' '),
  };
}

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0];
  for (const r of recs) if (r.size > big.size) big = r;
  return { buf, big, body: buf.slice(big.offset, big.offset + big.size) };
}

function enumerateLuaCounters(body, startGuess = 0x4bb50) {
  // Same walker as dig-pfact-7. <u32 lenChars> <UTF-16 ASCII> [<u32 value>...]
  const counters = [];
  let i = startGuess;
  while (i + 8 < body.length) {
    const len = body.readUInt32LE(i);
    if (len < 1 || len > 200) { i += 1; continue; }
    const strStart = i + 4;
    const strEnd = strStart + len * 2;
    if (strEnd >= body.length) break;
    let ok = true;
    for (let j = strStart; j < strEnd; j += 2) {
      const lo = body[j], hi = body[j + 1];
      if (hi !== 0 || lo < 0x20 || lo >= 0x7f) { ok = false; break; }
    }
    if (!ok) { i += 1; continue; }
    let s = '';
    for (let j = strStart; j < strEnd; j += 2) s += String.fromCharCode(body[j]);
    counters.push({ off: i, str: s, len });
    i = strEnd;
  }
  return counters;
}

const samples = [
  { label: 'save_10_fresh',    file: 'save_10_fresh.sav' },
  { label: 'ror_t1e',          file: 'ror_t1e.sav' },
  { label: 'ror_t2s',          file: 'ror_t2s.sav' },
  { label: 'ror_t5',           file: 'ror_t5.sav' },
  { label: 'ror_t11s',         file: 'ror_t11s.sav' },
  { label: 'ror_t11e',         file: 'ror_t11e.sav' },
  { label: 'save_1.2',         file: 'save_1.2.sav' },
  { label: 'save_mp_before',   file: 'save_mp_before.sav' },
  { label: 'save_mp_after',    file: 'save_mp_after.sav' },
  { label: 'athens_t21',       file: 'athens_t21.sav' },
  { label: 'athens_t22s',      file: 'athens_t22s.sav' },
  { label: 'athens_t22mid',    file: 'athens_t22mid.sav' },
  { label: 'athens_t22e',      file: 'athens_t22e.sav' },
];

for (const s of samples) {
  try {
    s.s = loadPlayer(s.file);
    s.headerTurn = readHeaderTurn(s.s.buf);
    s.headerYear = readHeaderYear(s.s.buf);
    s.headerRaw  = readHeaderRaw(s.s.buf);
  } catch (e) {
    s.err = e.message;
  }
}

// ===== 1. Print header turn/year for every save =====
console.log('=== Header turn + year (main.js readTurnFromSave / readCurrentYearFromSave) ===');
console.log('  (turn = u32_LE(@3968) + 1   |   year = i32_LE(@3972))');
console.log('');
console.log('  save                  hdrTurn  hdrYear   raw_u32@3968  i32@3968  i32@3972');
for (const s of samples) {
  if (s.err) { console.log(`  ${s.label.padEnd(20)} ERR: ${s.err}`); continue; }
  const r = s.headerRaw;
  console.log(`  ${s.label.padEnd(20)}  ${String(s.headerTurn).padStart(5)}    ${String(s.headerYear).padStart(6)}   ${String(r.u32_3968).padStart(10)}   ${String(r.i32_3968).padStart(8)}   ${String(r.i32_3972).padStart(7)}`);
}
console.log('');
console.log('  bytes 3960..3984 (hex) for each save:');
for (const s of samples) {
  if (s.err) continue;
  console.log(`    ${s.label.padEnd(20)} ${s.headerRaw.hex}`);
}

// ===== 2. Collect Lua counters for every save into a unified map =====
const counterTable = {}; // key -> { byLabel: {label: value} }
const counterByLabel = {}; // label -> Array<{str, value}>
for (const s of samples) {
  if (s.err) continue;
  const css = enumerateLuaCounters(s.s.body);
  counterByLabel[s.label] = css;
  for (const c of css) {
    const aff = c.off + 4 + c.len * 2;
    if (aff + 4 > s.s.body.length) continue;
    const u = s.s.body.readUInt32LE(aff);
    const i = s.s.body.readInt32LE(aff);
    if (!counterTable[c.str]) counterTable[c.str] = { byLabel: {}, ix32: {} };
    counterTable[c.str].byLabel[s.label] = u;
    counterTable[c.str].ix32[s.label] = i;
  }
}
const allKeys = Object.keys(counterTable);
console.log(`\n=== Total unique counter strings across all saves: ${allKeys.length} ===`);

// ===== 3. turn_number + any turn-ish counters across saves =====
const TURN_KEYS = allKeys.filter(k => /turn|year|current|count/i.test(k));
console.log(`\n=== Counters matching /turn|year|current|count/i (${TURN_KEYS.length}) — values across saves ===`);
const sLabels = samples.filter(s => !s.err).map(s => s.label);
const head = '  key'.padEnd(48) + sLabels.map(l => l.slice(0, 8).padStart(10)).join('');
console.log(head);
console.log('  ' + '-'.repeat(head.length - 2));
for (const key of TURN_KEYS) {
  const row = '  ' + key.padEnd(46);
  let cells = '';
  for (const lbl of sLabels) {
    const u = counterTable[key].byLabel[lbl];
    const i = counterTable[key].ix32[lbl];
    if (u === undefined) { cells += '         -'; continue; }
    // Show as signed if value looks negative (top bit set)
    if (u >= 0x80000000) cells += String(i).padStart(10);
    else cells += String(u).padStart(10);
  }
  console.log(row + cells);
}

// ===== 4. Specifically: turn_number vs header turn/year =====
console.log(`\n=== "turn_number" cross-reference with header turn ===`);
console.log('  save                 hdrTurn  hdrYear   turn_number(i32)   hdrTurn+tn   hdrTurn-tn  hdrYear+tn');
for (const s of samples) {
  if (s.err) continue;
  const tn = counterTable['turn_number']?.ix32?.[s.label];
  if (tn === undefined) {
    console.log(`  ${s.label.padEnd(20)}  ${String(s.headerTurn).padStart(5)}    ${String(s.headerYear).padStart(6)}     n/a`);
    continue;
  }
  const T = s.headerTurn, Y = s.headerYear;
  console.log(`  ${s.label.padEnd(20)}  ${String(T).padStart(5)}    ${String(Y).padStart(6)}      ${String(tn).padStart(6)}        ${String(T + tn).padStart(5)}        ${String(T - tn).padStart(5)}     ${String(Y + tn).padStart(6)}`);
}

// ===== 5. Top-20 dynamic Lua counters =====
// "Dynamic" = number of distinct u32 values across all saves where present.
console.log(`\n=== Top-20 most-dynamic Lua counters (by distinct u32 values across saves) ===`);
const ranking = allKeys.map(k => {
  const vals = Object.values(counterTable[k].byLabel);
  const set = new Set(vals);
  return { k, distinct: set.size, presence: vals.length, vals };
}).sort((a, b) => (b.distinct - a.distinct) || (b.presence - a.presence));

console.log('  rank  distinct  presence  key                                            sample-values');
for (let r = 0; r < Math.min(20, ranking.length); r++) {
  const row = ranking[r];
  const samp = row.vals.slice(0, 8).map(v => {
    if (v >= 0x80000000) return String(v - 0x100000000); // signed
    return String(v);
  }).join(',');
  console.log(`  ${String(r + 1).padStart(4)}  ${String(row.distinct).padStart(8)}  ${String(row.presence).padStart(8)}  ${row.k.padEnd(46)}   ${samp}`);
}

// ===== 6. Listing of all counters with at least 2 distinct values, sorted alphabetically =====
console.log(`\n=== All counters that change across saves (distinct >= 2), alphabetical ===`);
const changers = allKeys.filter(k => {
  const vals = Object.values(counterTable[k].byLabel);
  return (new Set(vals)).size >= 2;
}).sort();
console.log(`  Count: ${changers.length}`);
for (const k of changers) {
  const cells = sLabels.map(lbl => {
    const u = counterTable[k].byLabel[lbl];
    const i = counterTable[k].ix32[lbl];
    if (u === undefined) return '-';
    if (u >= 0x80000000) return String(i);
    return String(u);
  }).join('|');
  console.log(`    ${k.padEnd(46)}  ${cells}`);
}

// ===== 7. Sanity check: where does each save's Lua zone actually start? =====
console.log(`\n=== Lua-zone start scan (first counter offset per save) ===`);
for (const s of samples) {
  if (s.err) continue;
  const cs = counterByLabel[s.label];
  if (!cs || !cs.length) { console.log(`  ${s.label.padEnd(20)} no counters`); continue; }
  const first = cs[0];
  console.log(`  ${s.label.padEnd(20)} first counter at +0x${first.off.toString(16)}  "${first.str}"  (record body ${s.s.body.length} B)`);
}
