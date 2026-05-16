// dig-pfact-4.js — Session 102/D
// Drill into the tiny diffs from the 1-tile-move pair.
// The diff at 0x00c264..0x00c298 has 8 bytes changed on a stride of 4. Decode.
// Also test: where is the treasury, year-counter actually located?
//
// Strategy:
//   - Read the AFTER/BEFORE bytes at exact offsets in the 1-tile-move pair.
//   - Compare against the larger ror_t1e -> ror_t2s transition for turn-counter
//     and accumulator-style fields.
//
// Goal: pin ≥1 strong field by:
//   - confirming u32 turn-counter location
//   - confirming the AI/diplo entries changed at +0x00c264
//   - find Lua-counter increment location

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

const A = loadPlayer('save_mp_before.sav');
const B = loadPlayer('save_mp_after.sav');
const T1e = loadPlayer('ror_t1e.sav');
const T2s = loadPlayer('ror_t2s.sav');
const T5 = loadPlayer('ror_t5.sav');
const T11s = loadPlayer('ror_t11s.sav');
const T11e = loadPlayer('ror_t11e.sav');
const fresh = loadPlayer('save_10_fresh.sav');
const v12 = loadPlayer('save_1.2.sav');

// ===== Look at the stride-4 cluster at 0x00c264 in 1-tile-move pair =====
console.log(`=== Stride-4 cluster at 0x00c264..0x00c298 (1-tile-move diff) ===`);
console.log(`offset    A(before)   B(after)   delta`);
for (let off = 0x00c260; off <= 0x00c2a0; off += 4) {
  const a = A.body.readUInt32LE(off);
  const b = B.body.readUInt32LE(off);
  const aF = A.body.readFloatLE(off);
  const bF = B.body.readFloatLE(off);
  const tag = a !== b ? '  CHANGED' : '';
  console.log(`  +0x${off.toString(16).padStart(6,'0')}  u32=${a.toString().padStart(10)}  ${b.toString().padStart(10)}  f32=${aF.toFixed(3).padStart(10)}  ${bF.toFixed(3).padStart(10)}  d=${b - a}${tag}`);
}

// ===== Look at the entries surrounding 0x000004..8 in 1-tile-move pair (self-ptrs) =====
console.log(`\n=== Header bytes (offset 0..20) — self-ptr / magic / size? ===`);
console.log(`offset    A(before)              B(after)`);
for (let off = 0; off < 24; off += 4) {
  const a = A.body.readUInt32LE(off);
  const b = B.body.readUInt32LE(off);
  console.log(`  +0x${off.toString(16).padStart(2,'0')}  u32=0x${a.toString(16).padStart(8,'0')} (${a.toString().padStart(10)})  u32=0x${b.toString(16).padStart(8,'0')} (${b.toString().padStart(10)})`);
}
// The +4 and +8 are documented self-pointers (= record_offset + 4 and +8).
// Confirming A.big.offset+4 == A.body.readU32LE(4)
console.log(`Expected self-ptr (record_offset+4) in A: 0x${(A.big.offset+4).toString(16)}; in B: 0x${(B.big.offset+4).toString(16)}`);

// ===== Search across turn pairs for a u32 that increments by 1 — turn counter =====
console.log(`\n=== Looking for u32 that goes 1 -> 2 in t1e -> t2s and 11 -> ? ===`);
// For each offset, look for "u32 == 1 in t1e, == 2 in t2s, == 11 in t11s/e, etc."
function scanTurnCounter(saves) {
  // saves: [{label, value, body}, ...] where value is "the value we expect"
  const len = Math.min(...saves.map(s => s.body.length));
  const hits = [];
  for (let i = 0; i + 4 <= len; i += 4) {
    let ok = true;
    for (const s of saves) {
      const v = s.body.readUInt32LE(i);
      if (v !== s.value) { ok = false; break; }
    }
    if (ok) hits.push(i);
  }
  return hits;
}
const turnHits = scanTurnCounter([
  { label: 'ror_t1e', value: 1, body: T1e.body },
  { label: 'ror_t2s', value: 2, body: T2s.body },
  { label: 'ror_t5',  value: 5, body: T5.body },
  { label: 'ror_t11s',value: 11, body: T11s.body },
]);
console.log(`u32 turn-counter candidates: ${turnHits.length} hits`);
for (const h of turnHits.slice(0, 30)) console.log(`  +0x${h.toString(16).padStart(6,'0')}`);

// ===== Same but allow offset to be unaligned =====
const turnHitsUnaligned = (() => {
  const saves = [
    { label: 'ror_t1e', value: 1, body: T1e.body },
    { label: 'ror_t2s', value: 2, body: T2s.body },
    { label: 'ror_t5',  value: 5, body: T5.body },
    { label: 'ror_t11s',value: 11, body: T11s.body },
  ];
  const len = Math.min(...saves.map(s => s.body.length));
  const hits = [];
  for (let i = 0; i + 4 <= len; i++) {
    let ok = true;
    for (const s of saves) {
      const v = s.body.readUInt32LE(i);
      if (v !== s.value) { ok = false; break; }
    }
    if (ok) hits.push(i);
  }
  return hits;
})();
console.log(`u32 turn-counter (unaligned) candidates: ${turnHitsUnaligned.length} hits`);
for (const h of turnHitsUnaligned.slice(0, 30)) console.log(`  +0x${h.toString(16).padStart(6,'0')}`);

// ===== Treasury candidate scan =====
// On a starting turn (T0), a Roman player has 10000 in vanilla but the RIS mod
// may differ. Let's instead search for "what u32 / f32 changes by a small,
// consistent delta from t1e -> t2s and from t5 -> t11s" — those are
// monotone-money/income candidates.
// Find u32 that's positive in t1e and t2s, in [1000..100000], differ by < 5000.
console.log(`\n=== Treasury candidates (positive u32 in [1000, 100000], stable-ish across t1e/t2s) ===`);
{
  const len = Math.min(T1e.body.length, T2s.body.length);
  const cands = [];
  for (let i = 0; i + 4 <= len; i += 4) {
    const a = T1e.body.readUInt32LE(i);
    const b = T2s.body.readUInt32LE(i);
    if (a < 1000 || a > 200000) continue;
    if (b < 1000 || b > 200000) continue;
    const d = b - a;
    if (d > -5000 && d < 5000) cands.push({ off: i, a, b, d });
  }
  console.log(`  ${cands.length} u32 candidates (showing first 30)`);
  for (const c of cands.slice(0, 30)) {
    console.log(`  +0x${c.off.toString(16).padStart(6,'0')}  ${c.a} -> ${c.b}  (d=${c.d})`);
  }
}

// Also f32 in [1000, 200000]
console.log(`\n=== Treasury candidates (positive f32 in [1000, 200000], stable-ish across t1e/t2s) ===`);
{
  const len = Math.min(T1e.body.length, T2s.body.length);
  const cands = [];
  for (let i = 0; i + 4 <= len; i += 4) {
    const a = T1e.body.readFloatLE(i);
    const b = T2s.body.readFloatLE(i);
    if (!isFinite(a) || !isFinite(b)) continue;
    if (a < 1000 || a > 200000) continue;
    if (b < 1000 || b > 200000) continue;
    const d = b - a;
    if (Math.abs(d) > 5000) continue;
    cands.push({ off: i, a, b, d });
  }
  console.log(`  ${cands.length} f32 candidates (showing first 20)`);
  for (const c of cands.slice(0, 20)) {
    console.log(`  +0x${c.off.toString(16).padStart(6,'0')}  ${c.a.toFixed(2)} -> ${c.b.toFixed(2)}  (d=${c.d.toFixed(2)})`);
  }
}

// ===== List ALL Lua-counter strings + values in save_1.2's player record =====
// The Lua state region 0x4bb5b onward has interleaved <UTF-16 name> <u32 value>
// or similar. Let's dig the structure.
console.log(`\n=== Lua-counter footer head bytes (0x4bb40..0x4bc00) ===`);
{
  const buf = v12.body;
  let i = 0x4bb40;
  let line = '';
  for (; i < 0x4bc00 && i < buf.length; i++) {
    line += buf[i].toString(16).padStart(2, '0') + ' ';
    if ((i & 0xf) === 0xf) {
      console.log(`  0x${(i & ~0xf).toString(16).padStart(6, '0')}  ${line}`);
      line = '';
    }
  }
}

// Count the number of UTF-16 strings starting at 0x4bb5b onward and dump first 20 with following bytes
console.log(`\n=== Lua-counter records (first 20) ===`);
{
  const buf = v12.body;
  let p = 0x4bb5b;
  // A counter record probably begins with a u16/u8 length, then UTF-16 chars, then u32 value
  // Hand-walk from a known-good string offset
  // Header: 0x4bb5b started "Bdata/world..." (B=0x42), so it's not the first record header.
  // Look at bytes just before to find structure
  console.log(`  Bytes 0x4bb50..0x4bb70:`);
  for (let i = 0x4bb50; i < 0x4bb70; i++) {
    process.stdout.write(buf[i].toString(16).padStart(2, '0') + ' ');
  }
  console.log();
}
