// dig-pfact-7.js — Session 102/G
// Pin Lua-counter value layout. Take save_1.2 player record, find ALL
// counter strings, and read u32 just before & just after. Find one whose
// value-after matches the expected turn-number / treasury / population.
//
// Also: find what the +0x000fbc 8194.5010 f32 actually represents. It's
// "0x45 00 00 00 ... 8194.5" — across all NPC factions too?

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function loadPlayer(file) {
  const buf = fs.readFileSync(path.join(FIX, file));
  const recs = findFactionRecords(buf);
  let big = recs[0];
  for (const r of recs) if (r.size > big.size) big = r;
  return { buf, recs, big, body: buf.slice(big.offset, big.offset + big.size) };
}

const samples = [
  { label: 'save_10_fresh', file: 'save_10_fresh.sav' },
  { label: 'ror_t1e',       file: 'ror_t1e.sav' },
  { label: 'ror_t2s',       file: 'ror_t2s.sav' },
  { label: 'ror_t5',        file: 'ror_t5.sav' },
  { label: 'ror_t11s',      file: 'ror_t11s.sav' },
  { label: 'save_1.2',      file: 'save_1.2.sav' },
];
for (const s of samples) s.s = loadPlayer(s.file);

// ===== Find Lua counters with structure: <u32 lenChars> <UTF-16 string> <u32 value> =====
// Use save_1.2 as a reference.
console.log(`=== Lua counters in save_1.2 player record ===`);
function enumerateLuaCounters(body, startGuess = 0x4bb50) {
  // Walk forward. Each counter:
  //   u32 lenChars (small, say 4..50)
  //   UTF-16 chars (lenChars * 2 bytes)
  //   then... maybe u32 value or more
  // The first "counter" entry in the dump was 0x35 (=53) chars "Bdata/world/maps/.../RIS_Campaign_Script.txts" — that's a path, not counter.
  // So Lua state has multiple sections.
  const counters = [];
  let i = startGuess;
  while (i + 8 < body.length) {
    const len = body.readUInt32LE(i);
    if (len < 1 || len > 200) {
      i += 1;
      continue;
    }
    const strStart = i + 4;
    const strEnd = strStart + len * 2;
    if (strEnd >= body.length) break;
    // Validate UTF-16 ASCII
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

const cs = enumerateLuaCounters(samples.find(x => x.label === 'save_1.2').s.body);
console.log(`Found ${cs.length} Lua-state strings.`);
// Look for "turn_number" specifically
for (const c of cs.slice(0, 5)) {
  console.log(`  +0x${c.off.toString(16).padStart(6, '0')}  len=${c.len}  "${c.str}"`);
}
console.log(`...`);
const turnIdx = cs.findIndex(c => c.str === 'turn_number');
console.log(`"turn_number" found at index ${turnIdx}: +0x${cs[turnIdx]?.off.toString(16)}`);

// Read u32 value after each counter for all samples
console.log(`\n=== For "turn_number": value u32 BEFORE name, value u32 AFTER name, across saves ===`);
for (const sm of samples) {
  const css = enumerateLuaCounters(sm.s.body);
  const tn = css.find(c => c.str === 'turn_number');
  if (!tn) {
    console.log(`  ${sm.label.padEnd(16)}  NOT FOUND`);
    continue;
  }
  const afterStart = tn.off + 4 + tn.len * 2;
  const after_u32 = sm.s.body.readUInt32LE(afterStart);
  const after_i32 = sm.s.body.readInt32LE(afterStart);
  const after2_u32 = sm.s.body.readUInt32LE(afterStart + 4);
  const after3_u32 = sm.s.body.readUInt32LE(afterStart + 8);
  console.log(`  ${sm.label.padEnd(16)}  off=+0x${tn.off.toString(16)}  after+0=${after_u32}/${after_i32}  +4=${after2_u32}  +8=${after3_u32}`);
}

// ===== A few specific keys' values across saves =====
const keys = ['turn_number', 'capital_first_setup', 'num_battles_seleucids_rome', 'ptolemaic_therapeia_recruit_count'];
console.log(`\n=== Each Lua counter's u32 after-string, across saves ===`);
for (const key of keys) {
  console.log(`\n  Key "${key}":`);
  for (const sm of samples) {
    const css = enumerateLuaCounters(sm.s.body);
    const k = css.find(c => c.str === key);
    if (!k) { console.log(`    ${sm.label.padEnd(16)}  NOT FOUND`); continue; }
    const aff = k.off + 4 + k.len * 2;
    const v = sm.s.body.readUInt32LE(aff);
    const i = sm.s.body.readInt32LE(aff);
    console.log(`    ${sm.label.padEnd(16)}  +0x${k.off.toString(16).padStart(6,'0')}  u32_after=${v} (i32=${i})  +4=${sm.s.body.readUInt32LE(aff+4)} +8=${sm.s.body.readUInt32LE(aff+8)}`);
  }
}

// ===== What's at +0x000fbc? Look at u8 sequence around it =====
console.log(`\n=== Bytes around +0x000fbc in save_10_fresh and ror_t5 (where it differs) ===`);
{
  const fresh = samples.find(s => s.label === 'save_10_fresh').s;
  const t5 = samples.find(s => s.label === 'ror_t5').s;
  const start = 0x000fa0;
  const end = 0x000fd8;
  console.log(`save_10_fresh:`);
  for (let i = start; i < end; i += 16) {
    let line = '';
    for (let j = 0; j < 16 && i + j < end; j++) line += fresh.body[i + j].toString(16).padStart(2, '0') + ' ';
    console.log(`  +0x${i.toString(16).padStart(6,'0')}  ${line}`);
  }
  console.log(`ror_t5:`);
  for (let i = start; i < end; i += 16) {
    let line = '';
    for (let j = 0; j < 16 && i + j < end; j++) line += t5.body[i + j].toString(16).padStart(2, '0') + ' ';
    console.log(`  +0x${i.toString(16).padStart(6,'0')}  ${line}`);
  }
}

// ===== Section boundary: detect zone changes from byte-distribution. Use 1024-byte windows =====
console.log(`\n=== Coarse-grained section detection (1024-byte windows, save_1.2 player record) ===`);
console.log(`Looking for places where dominant-byte-class changes sharply.`);
{
  const body = samples.find(s => s.label === 'save_1.2').s.body;
  const WIN = 1024;
  let prevClass = null;
  let inSection = { start: 0, cls: null };
  function classify(zero, ff, print, total) {
    const z = zero / total;
    const f = ff / total;
    const p = print / total;
    if (z > 0.5) return 'sparse';
    if (p > 0.3) return 'ascii/utf';
    if (f > 0.3) return 'ff-dense';
    return 'binary';
  }
  const sections = [];
  for (let w = 0; w * WIN < body.length; w++) {
    const s = w * WIN, e = Math.min(s + WIN, body.length);
    let zero = 0, ff = 0, print = 0;
    for (let i = s; i < e; i++) {
      const b = body[i];
      if (b === 0) zero++;
      else if (b === 0xff) ff++;
      else if (b >= 0x20 && b < 0x7f) print++;
    }
    const cls = classify(zero, ff, print, e - s);
    if (cls !== inSection.cls) {
      if (inSection.cls !== null) sections.push({ ...inSection, end: s });
      inSection = { start: s, cls };
    }
  }
  sections.push({ ...inSection, end: body.length });
  for (const s of sections) {
    console.log(`  0x${s.start.toString(16).padStart(6,'0')}..0x${s.end.toString(16).padStart(6,'0')}  len=${s.end - s.start}  class=${s.cls}`);
  }
}
