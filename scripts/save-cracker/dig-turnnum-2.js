// dig-turnnum-2.js — Session 104 follow-up
//
// readTurnFromSave returns 0 (→ "turn 1") on every RIS sample. The header
// offset 3968 documented in main.js is wrong for Remastered/RIS. Scan the
// first ~16 KB of every save for u32 values that match each save's known
// turn number, and also for i32/u32 values that match plausible year
// values (e.g. -270, -260, -240).

'use strict';

const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'feral');

// Known turn per filename. ror_* are Romans Julii campaign.
// athens_* are an Athens campaign starting much later.
// save_1.2 is some mid-campaign unknown turn (Saka). save_10_fresh = T0/T1.
const KNOWN = {
  'save_10_fresh.sav':   { turn: 1,  // T0 == game start, displayed as Turn 1
                           note: 'fresh start' },
  'ror_t1e.sav':         { turn: 1, note: 'turn 1 end' },
  'ror_t2s.sav':         { turn: 2, note: 'turn 2 start' },
  'ror_t5.sav':          { turn: 5, note: 'turn 5' },
  'ror_t11s.sav':        { turn: 11, note: 'turn 11 start' },
  'ror_t11e.sav':        { turn: 11, note: 'turn 11 end' },
  'save_1.2.sav':        { turn: null, note: 'unknown' },
  'save_mp_before.sav':  { turn: null, note: 'pre-move' },
  'save_mp_after.sav':   { turn: null, note: 'post-move' },
  'athens_t21.sav':      { turn: 21, note: 'athens turn 21' },
  'athens_t22s.sav':     { turn: 22, note: 'athens turn 22 start' },
  'athens_t22mid.sav':   { turn: 22, note: 'athens turn 22 mid' },
  'athens_t22e.sav':     { turn: 22, note: 'athens turn 22 end' },
};

function load(file) {
  return fs.readFileSync(path.join(FIX, file));
}

// Scan first N bytes for u32 LE matching a target value
function findU32(buf, target, maxOff = 16384) {
  const hits = [];
  const lim = Math.min(buf.length - 4, maxOff);
  for (let i = 0; i < lim; i++) {
    if (buf.readUInt32LE(i) === target) hits.push(i);
  }
  return hits;
}

function findI32(buf, target, maxOff = 16384) {
  const hits = [];
  const lim = Math.min(buf.length - 4, maxOff);
  for (let i = 0; i < lim; i++) {
    if (buf.readInt32LE(i) === target) hits.push(i);
  }
  return hits;
}

const files = Object.keys(KNOWN);

// ===== 1. For each save with known turn, find all u32 offsets matching turn or (turn-1) =====
console.log('=== Find all u32 LE offsets matching expected turn (and turn-1) in first 16 KB ===');
for (const f of files) {
  const k = KNOWN[f];
  if (!k.turn) continue;
  const buf = load(f);
  const t = k.turn;
  const tm1 = t - 1;
  const hitsT = findU32(buf, t);
  const hitsTm1 = findU32(buf, tm1);
  console.log(`  ${f.padEnd(22)} turn=${t}  u32==${t}: ${hitsT.length} hits @ ${hitsT.slice(0, 6).map(h => '0x' + h.toString(16)).join(',')}  | u32==${tm1}: ${hitsTm1.length} hits @ ${hitsTm1.slice(0, 8).map(h => '0x' + h.toString(16)).join(',')}`);
}

// ===== 2. Cross-reference: which u32 offsets contain turn==N for EVERY save? =====
console.log('\n=== Stable offsets: u32 LE position whose value == known-turn across all known-turn saves ===');
{
  const knownFiles = files.filter(f => KNOWN[f].turn !== null);
  // For each candidate offset, check if u32 there == known turn for every save
  const maxOff = 16384;
  // For efficiency, find offsets in the first save where u32==turn, then verify on others.
  const firstK = knownFiles[0];
  const firstBuf = load(firstK);
  const firstTurn = KNOWN[firstK].turn;
  const candidates = findU32(firstBuf, firstTurn, maxOff);
  const stable = [];
  for (const off of candidates) {
    let ok = true;
    for (const f of knownFiles) {
      const b = load(f);
      const t = KNOWN[f].turn;
      if (b.length < off + 4) { ok = false; break; }
      if (b.readUInt32LE(off) !== t) { ok = false; break; }
    }
    if (ok) stable.push(off);
  }
  console.log(`  Found ${stable.length} stable u32 offsets where value == known turn across all saves:`);
  for (const off of stable.slice(0, 50)) {
    // print a row showing each save's value at that offset
    const row = knownFiles.map(f => {
      const b = load(f);
      const v = b.readUInt32LE(off);
      const i = b.readInt32LE(off);
      return `${f.split('.')[0].slice(0, 14)}=${v}/${i}`;
    }).join('  ');
    console.log(`    0x${off.toString(16).padStart(4, '0')}  ${row}`);
  }
}

// ===== 3. Also: stable offsets where u32 == (turn - 1), since some engines store 0-indexed =====
console.log('\n=== Stable offsets: u32 LE position whose value == (known-turn - 1) across all known-turn saves ===');
{
  const knownFiles = files.filter(f => KNOWN[f].turn !== null);
  const firstK = knownFiles[0];
  const firstBuf = load(firstK);
  const firstTurn = KNOWN[firstK].turn - 1;
  const maxOff = 16384;
  const candidates = findU32(firstBuf, firstTurn, maxOff);
  const stable = [];
  for (const off of candidates) {
    let ok = true;
    for (const f of knownFiles) {
      const b = load(f);
      const t = KNOWN[f].turn - 1;
      if (b.length < off + 4) { ok = false; break; }
      if (b.readUInt32LE(off) !== t) { ok = false; break; }
    }
    if (ok) stable.push(off);
  }
  console.log(`  Found ${stable.length} stable u32 offsets where value == known turn-1 across all saves:`);
  for (const off of stable.slice(0, 50)) {
    const row = knownFiles.map(f => {
      const b = load(f);
      const v = b.readUInt32LE(off);
      return `${f.split('.')[0].slice(0, 14)}=${v}`;
    }).join('  ');
    console.log(`    0x${off.toString(16).padStart(4, '0')}  ${row}`);
  }
}

// ===== 4. Tilt: scan entire file (not just header) for u32 == turn? Too noisy.
// Instead: dump the bytes around offset 3968 (where main.js claims) for ror_t11e
// and compare to a vanilla classic-era file shape.
console.log('\n=== Bytes around documented main.js header turn offset (0xf80=3968) per save ===');
for (const f of files) {
  const k = KNOWN[f];
  const buf = load(f);
  const hex = [...buf.slice(3950, 3990)].map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  ${f.padEnd(22)} turn=${k.turn === null ? '?' : k.turn}  @3950..3990: ${hex}`);
}

// ===== 5. Scan the FIRST 256 bytes of every save — header is rich here =====
console.log('\n=== First 64 bytes (hex) per save ===');
for (const f of files) {
  const k = KNOWN[f];
  const buf = load(f);
  const hex = [...buf.slice(0, 64)].map(b => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  ${f.padEnd(22)} turn=${k.turn === null ? '?' : k.turn}  ${hex}`);
}

// ===== 6. Find offsets of the f32-looking "campaign clock" at 0x04 =====
console.log('\n=== f32 LE at offset 4 (campaign clock?) per save ===');
for (const f of files) {
  const k = KNOWN[f];
  const buf = load(f);
  const clock = buf.readFloatLE(4);
  const u32_at_4 = buf.readUInt32LE(4);
  console.log(`  ${f.padEnd(22)} turn=${k.turn === null ? '?' : String(k.turn).padStart(2)}  f32@4=${clock.toFixed(4)}  u32@4=0x${u32_at_4.toString(16)}`);
}
