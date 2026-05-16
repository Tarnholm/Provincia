// dig-turnnum-4.js — Session 104 confirmation
//
// Confirm 0x44e3 is the absolute-turn offset by dumping context bytes
// (16 before, 16 after) and verifying the field is bounded properly.

'use strict';

const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'feral');

const SAVES = [
  ['save_10_fresh.sav',   1],
  ['ror_t1e.sav',         1],
  ['ror_t2s.sav',         2],
  ['ror_t5.sav',          5],
  ['ror_t11s.sav',        11],
  ['ror_t11e.sav',        11],
  ['save_1.2.sav',        null],
  ['save_mp_before.sav',  null],
  ['save_mp_after.sav',   null],
  ['athens_t21.sav',      21],
  ['athens_t22s.sav',     22],
  ['athens_t22mid.sav',   22],
  ['athens_t22e.sav',     22],
];

console.log('=== Bytes around offset 0x44e3 in every save ===');
console.log('  save                 turn  bytes[0x44d3..0x44f7]                                      u32@0x44e3  turn=v+1');
for (const [f, t] of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, f));
  if (buf.length < 0x44f7) { console.log(`  ${f.padEnd(20)} too short`); continue; }
  const hex = [...buf.slice(0x44d3, 0x44f7)].map(b => b.toString(16).padStart(2, '0')).join(' ');
  const v = buf.readUInt32LE(0x44e3);
  const tStr = (t === null ? '?' : String(t)).padStart(3);
  console.log(`  ${f.padEnd(20)} ${tStr}   ${hex}   ${String(v).padStart(4)}   ${v + 1}`);
}

// Also confirm: the value at 0x44e3 == turn-1 in every test
console.log('\n=== Verification: read 0x44e3 as u32 LE and compute turn = value + 1 ===');
for (const [f, t] of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, f));
  const v = buf.readUInt32LE(0x44e3);
  const computed = v + 1;
  const ok = (t === null) ? '(unknown)' : (computed === t ? 'OK' : `MISMATCH expected=${t}`);
  console.log(`  ${f.padEnd(20)} expected=${t === null ? '?' : t}  read=${v}  → turn=${computed}  ${ok}`);
}

// Save unknown turns: report them for reference
console.log('\n=== Inferred turn for unknown saves ===');
for (const [f, t] of SAVES) {
  if (t !== null) continue;
  const buf = fs.readFileSync(path.join(FIX, f));
  const v = buf.readUInt32LE(0x44e3);
  console.log(`  ${f.padEnd(20)} turn = ${v + 1} (raw u32 = ${v})`);
}
