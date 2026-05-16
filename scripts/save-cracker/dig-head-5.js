// dig-head-5.js — Session 107 / 5
// Cross-references and verification:
//  - Confirm the trailing 23.6 KB stride-4 u16 lookup is ALWAYS present (same size in every save)
//  - Count how many <ff 0a af f0> "message header" magics are in HEAD per save -- correlates with turn count
//  - Count Settlement Lost / Settlement Gained UTF-16 strings per save
//  - Find: are there other magic markers besides ff0aaff0?

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = [
  'save_10_fresh.sav', 'save_1.2.sav',
  'save_mp_before.sav', 'save_mp_after.sav',
  'ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav',
  'ror_t11s.sav', 'ror_t11e.sav',
  'athens_t21.sav', 'athens_t22s.sav', 'athens_t22mid.sav', 'athens_t22e.sav',
];

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function getHead(savFile) {
  const buf = fs.readFileSync(path.join(FIX, savFile));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
  return { buf, REC, firstBarb, head: buf.slice(REC + 0xc400, firstBarb), file: savFile, recSize: player.size };
}

const MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);

console.log(`save                            headLen    nMagic  nSettLost  nSettGain  tailZoneStart  tailLen  tailLookup_unique  tailLookup_max`);
for (const sv of SAVES) {
  const { head } = getHead(sv);
  // count magics
  let mc = 0; let p = 0;
  while ((p = head.indexOf(MAGIC, p)) !== -1) { mc++; p++; }
  // count UTF-16 "Settlement Lost" and "Settlement Gained"
  const lostN = Buffer.from('Settlement Lost', 'utf16le');
  const gainN = Buffer.from('Settlement Gained', 'utf16le');
  let lost = 0; p = 0; while ((p = head.indexOf(lostN, p)) !== -1) { lost++; p++; }
  let gain = 0; p = 0; while ((p = head.indexOf(gainN, p)) !== -1) { gain++; p++; }
  // Tail zone: find where ASCII-byte fraction drops below 20% in a 4 KB rolling window
  // Easier: assume tail is always 23.6 KB stride-4 lookup. Find the start by scanning backward.
  // Use: the last 24 KB should be stride-4 small u16 values.
  // We can spot the boundary by: find the LARGEST k such that head[k..end-X] has byte stats matching the lookup table.
  // Simpler heuristic: take the last 23608 bytes (T0 size), check if it looks like lookup.
  const tailSize = 23608;
  const tail = head.slice(Math.max(0, head.length - tailSize));
  let small = 0; let smallSet = new Set(); let maxV = 0;
  for (let i = 0; i + 4 <= tail.length; i += 4) {
    const v = tail.readUInt32LE(i);
    if (v < 65536) { small++; smallSet.add(v); if (v > maxV) maxV = v; }
  }
  const tailStart = Math.max(0, head.length - tailSize);
  console.log(`${sv.padEnd(32)}  ${head.length.toString().padStart(8)}  ${mc.toString().padStart(5)}  ${lost.toString().padStart(8)}  ${gain.toString().padStart(8)}  +0x${tailStart.toString(16).padStart(6,'0')}     ${tail.length.toString().padStart(6)}   ${smallSet.size.toString().padStart(6)}  ${maxV.toString().padStart(6)}`);
}

// Now look at the head ZONE just before tail to see how it grows per turn
// For T0 / T1 saves, the entire head IS the lookup table (~23.6 KB == 23608 bytes).
// For larger saves, the growing zone is everything before.

// Compare turn-progression: turn growth in the "growing zone"
console.log(`\n=== Growing zone size (head minus 23.6 KB tail) per turn ===`);
console.log(`save                              growingZone  bytesPerTurn-estimate-from-T0`);
const T0 = getHead('save_10_fresh.sav').head.length; // 23608
const SAVES_TURNED = [
  { sv: 'save_10_fresh.sav', turns: 0 },
  { sv: 'save_1.2.sav', turns: 0 }, // unknown turn count
  { sv: 'ror_t1e.sav', turns: 1 },
  { sv: 'ror_t2s.sav', turns: 1 },
  { sv: 'ror_t5.sav', turns: 5 },
  { sv: 'ror_t11s.sav', turns: 11 },
  { sv: 'ror_t11e.sav', turns: 11 },
  { sv: 'athens_t21.sav', turns: 21 },
  { sv: 'athens_t22s.sav', turns: 22 },
  { sv: 'athens_t22e.sav', turns: 22 },
];
for (const { sv, turns } of SAVES_TURNED) {
  const head = getHead(sv).head;
  const growing = Math.max(0, head.length - 23608);
  const perTurn = turns > 0 ? (growing / turns).toFixed(0) : '-';
  console.log(`${sv.padEnd(32)}  ${growing.toString().padStart(10)}  ${perTurn}`);
}

// Look for OTHER magics in HEAD - search for any 4-byte values that have very high counts (suggesting record headers)
console.log(`\n=== Candidate record-magic 4-byte values (high freq at 4-aligned positions in HEAD growing zone of ror_t11s) ===`);
const { head: rorH11s } = getHead('ror_t11s.sav');
const grow = rorH11s.slice(0, rorH11s.length - 23608);
const u32Freq4 = new Map();
for (let i = 0; i + 4 <= grow.length; i += 4) {
  const v = grow.readUInt32LE(i);
  u32Freq4.set(v, (u32Freq4.get(v) || 0) + 1);
}
const sorted = [...u32Freq4.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 25);
for (const [v, c] of sorted) {
  // show as hex and ASCII
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  let asc = '';
  for (let k = 0; k < 4; k++) asc += b[k] >= 0x20 && b[k] < 0x7f ? String.fromCharCode(b[k]) : '.';
  console.log(`  0x${v.toString(16).padStart(8,'0')} = ${v}  hex=${b.toString('hex')}  ascii="${asc}"  count=${c}`);
}

// Look at the "Settlement message" records: scan for them and decode the structure.
// We saw the magic ff0aaff0 right BEFORE message records. Let me confirm by looking at ALL magics' contexts.
console.log(`\n=== Bytes around each "ff 0a af f0" magic in HEAD (ror_t11s, first 8 occurrences) ===`);
{
  const head = rorH11s;
  let p = 0; let occ = 0;
  while ((p = head.indexOf(MAGIC, p)) !== -1 && occ < 8) {
    console.log(`\n  Magic #${occ} at HEAD+0x${p.toString(16)}:`);
    const ctxStart = Math.max(0, p - 8);
    const ctxEnd = Math.min(head.length, p + 64);
    for (let i = ctxStart; i < ctxEnd; i += 16) {
      process.stdout.write(`    +0x${i.toString(16).padStart(5,'0')}  `);
      for (let j = 0; j < 16 && i+j < ctxEnd; j++) process.stdout.write(head[i+j].toString(16).padStart(2,'0')+' ');
      for (let j = (ctxEnd - i); j < 16; j++) process.stdout.write('   ');
      process.stdout.write('  ');
      for (let j = 0; j < 16 && i+j < ctxEnd; j++) {
        const c = head[i+j];
        process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
      }
      console.log();
    }
    p++;
    occ++;
  }
}

// CROSS-CHECK: are character secondaryUuids present in HEAD?
// Find a few characters by structural scan, then check their secondaryUuid in HEAD.
console.log(`\n=== Cross-check: character secondaryUuids found in HEAD ===`);
const { buf: t11sBuf, head: t11sHead } = getHead('ror_t11s.sav');
// Quick structural scan: look for u32=6 followed by uuid + (x,y) in 1..500 + valid mp
const fileWideUuids = new Set();
for (let i = 100; i + 64 < t11sBuf.length; i++) {
  const hdr = t11sBuf.readUInt32LE(i - 4);
  if (hdr !== 6 && hdr !== 4) continue;
  const u = t11sBuf.readUInt32LE(i);
  if (u === 0 || u === 0xffffffff) continue;
  const x = t11sBuf.readUInt32LE(i + 8);
  const y = t11sBuf.readUInt32LE(i + 12);
  if (x < 1 || x > 500 || y < 1 || y > 500) continue;
  const mp = t11sBuf.readFloatLE(i + 58);
  if (!isFinite(mp) || mp < 0 || mp > 1000) continue;
  fileWideUuids.add(u);
}
console.log(`  Total char-like secondaryUuids in save: ${fileWideUuids.size}`);
// How many appear as a 4-byte u32 in HEAD?
let hit4 = 0, hit2 = 0;
for (let i = 0; i + 4 <= t11sHead.length; i += 4) {
  if (fileWideUuids.has(t11sHead.readUInt32LE(i))) hit4++;
}
for (let i = 0; i + 4 <= t11sHead.length; i += 2) {
  if (fileWideUuids.has(t11sHead.readUInt32LE(i))) hit2++;
}
console.log(`  HEAD 4-aligned hits: ${hit4} / ${Math.floor(t11sHead.length/4)} = ${(100*hit4/Math.floor(t11sHead.length/4)).toFixed(2)}%`);
console.log(`  HEAD 2-aligned hits: ${hit2} / ${Math.floor(t11sHead.length/2)} = ${(100*hit2/Math.floor(t11sHead.length/2)).toFixed(2)}%`);
// Random baseline: expect # of 4-aligned hits if random ~= fileWideUuids.size * floor(headLen/4) / 2^32
const randomBaseline = fileWideUuids.size * Math.floor(t11sHead.length/4) / Math.pow(2, 32);
console.log(`  Random baseline (uniform 32-bit) for that many uuid values: ${randomBaseline.toFixed(2)}`);
console.log(`  Observed vs random: ${(hit4 / Math.max(1, randomBaseline)).toFixed(1)}x`);
