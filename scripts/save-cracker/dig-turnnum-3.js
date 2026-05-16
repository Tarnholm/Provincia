// dig-turnnum-3.js — Session 104 follow-up #2
//
// Scan the FULL file for u32 LE values matching the known turn for athens_t22*
// saves (which had no hits in the first 16 KB). Also: u16 LE and u8 scans.
// Goal: locate any stable offset that holds the absolute turn.

'use strict';

const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'feral');

const KNOWN = {
  'save_10_fresh.sav':   1,
  'ror_t1e.sav':         1,
  'ror_t2s.sav':         2,
  'ror_t5.sav':          5,
  'ror_t11s.sav':        11,
  'ror_t11e.sav':        11,
  'athens_t21.sav':      21,
  'athens_t22s.sav':     22,
  'athens_t22mid.sav':   22,
  'athens_t22e.sav':     22,
};

function load(f) { return fs.readFileSync(path.join(FIX, f)); }

// Find u32 == target in entire file. Return first 20 offsets.
function findU32Full(buf, target, max = 20) {
  const hits = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === target) {
      hits.push(i);
      if (hits.length >= max) break;
    }
  }
  return hits;
}
function findU16Full(buf, target, max = 30) {
  const hits = [];
  for (let i = 0; i + 2 <= buf.length; i++) {
    if (buf.readUInt16LE(i) === target) {
      hits.push(i);
      if (hits.length >= max) break;
    }
  }
  return hits;
}

// For each save, find FIRST u32 == known turn in the entire file.
console.log('=== First u32==turn offset (full-file scan) ===');
for (const [f, t] of Object.entries(KNOWN)) {
  const buf = load(f);
  const hits = findU32Full(buf, t, 10);
  console.log(`  ${f.padEnd(22)} turn=${String(t).padStart(2)}  size=${buf.length}  first u32==${t} at: ${hits.slice(0, 6).map(h => '0x' + h.toString(16)).join(', ')}`);
}

// Look for stable offsets across all athens_t22 saves (since they all have turn 22)
console.log('\n=== Athens-T22 saves: u32==22 offsets (full-file) intersection ===');
{
  const aFiles = ['athens_t22s.sav', 'athens_t22mid.sav', 'athens_t22e.sav'];
  const bufs = aFiles.map(load);
  // Find all u32==22 offsets in first
  const limit = Math.min(...bufs.map(b => b.length));
  let hits0 = [];
  for (let i = 0; i + 4 <= bufs[0].length; i++) {
    if (bufs[0].readUInt32LE(i) === 22) hits0.push(i);
  }
  console.log(`  athens_t22s has ${hits0.length} total u32==22 hits`);
  // Filter: keep only offsets where all 3 saves have u32==22 (saves differ
  // in size, so offsets near EOF may not line up — but file head should)
  const inter = hits0.filter(off => {
    return bufs.every(b => b.length >= off + 4 && b.readUInt32LE(off) === 22);
  });
  console.log(`  Stable u32==22 across all 3 athens_t22 saves: ${inter.length} offsets`);
  for (const off of inter.slice(0, 40)) {
    // Print value at the same offset in OTHER saves (ror_t11 should show 11, athens_t21 should show 21)
    const tail = ['ror_t11s.sav', 'ror_t11e.sav', 'athens_t21.sav', 'ror_t5.sav', 'ror_t2s.sav', 'ror_t1e.sav', 'save_10_fresh.sav'].map(f => {
      const b = load(f);
      if (b.length < off + 4) return `${f.slice(0, 8)}=OOB`;
      return `${f.split('.')[0].slice(0, 10)}=${b.readUInt32LE(off)}`;
    }).join('  ');
    console.log(`    0x${off.toString(16)}  ${tail}`);
  }
}

// And then THE killer: find an offset where value == expected turn in EVERY
// save (not just athens). Full-file scan, intersection over all 10 known-turn saves.
console.log('\n=== FULL-FILE intersection: offset where u32 == known-turn in EVERY save ===');
{
  const known = Object.entries(KNOWN);
  const firstFile = known[0][0];
  const firstBuf = load(firstFile);
  const firstTurn = KNOWN[firstFile];
  // Find candidates in first save
  let candidates = [];
  for (let i = 0; i + 4 <= firstBuf.length; i++) {
    if (firstBuf.readUInt32LE(i) === firstTurn) candidates.push(i);
  }
  console.log(`  first save (${firstFile}) has ${candidates.length} u32==${firstTurn} hits`);
  // Filter against every other save
  for (const [f, t] of known) {
    const b = load(f);
    candidates = candidates.filter(off => b.length >= off + 4 && b.readUInt32LE(off) === t);
  }
  console.log(`  Survivors after intersecting all ${known.length} saves: ${candidates.length}`);
  for (const off of candidates.slice(0, 50)) {
    const row = known.map(([f, t]) => {
      const b = load(f);
      return `${f.split('.')[0].slice(0, 8)}=${b.readUInt32LE(off)}`;
    }).join(' ');
    console.log(`    0x${off.toString(16)}  ${row}`);
  }
}

// Also try (turn - 1) intersection
console.log('\n=== FULL-FILE intersection: offset where u32 == (turn - 1) in EVERY save ===');
{
  const known = Object.entries(KNOWN);
  const firstFile = known[0][0];
  const firstBuf = load(firstFile);
  const firstTurnM1 = KNOWN[firstFile] - 1;
  let candidates = [];
  for (let i = 0; i + 4 <= firstBuf.length; i++) {
    if (firstBuf.readUInt32LE(i) === firstTurnM1) candidates.push(i);
  }
  console.log(`  first save (${firstFile}) has ${candidates.length} u32==${firstTurnM1} hits`);
  for (const [f, t] of known) {
    const b = load(f);
    const tm1 = t - 1;
    candidates = candidates.filter(off => b.length >= off + 4 && b.readUInt32LE(off) === tm1);
  }
  console.log(`  Survivors after intersecting all ${known.length} saves: ${candidates.length}`);
  for (const off of candidates.slice(0, 50)) {
    const row = known.map(([f, t]) => {
      const b = load(f);
      return `${f.split('.')[0].slice(0, 8)}=${b.readUInt32LE(off)}`;
    }).join(' ');
    console.log(`    0x${off.toString(16)}  ${row}`);
  }
}

// And try u16 LE with value == turn (athens_t22 may store turn as u16!)
console.log('\n=== FULL-FILE u16 intersection ===');
{
  const known = Object.entries(KNOWN);
  const firstFile = known[0][0];
  const firstBuf = load(firstFile);
  const firstTurn = KNOWN[firstFile];
  let candidates = [];
  for (let i = 0; i + 2 <= firstBuf.length; i++) {
    if (firstBuf.readUInt16LE(i) === firstTurn) candidates.push(i);
    if (candidates.length > 200000) break;
  }
  console.log(`  first save (${firstFile}) has ${candidates.length} u16==${firstTurn} hits`);
  for (const [f, t] of known) {
    const b = load(f);
    candidates = candidates.filter(off => b.length >= off + 2 && b.readUInt16LE(off) === t);
  }
  console.log(`  Survivors after intersecting all ${known.length} saves: ${candidates.length}`);
  for (const off of candidates.slice(0, 30)) {
    const row = known.map(([f, t]) => {
      const b = load(f);
      return `${f.split('.')[0].slice(0, 8)}=${b.readUInt16LE(off)}`;
    }).join(' ');
    console.log(`    0x${off.toString(16)}  ${row}`);
  }
}

// And u16 with value == (turn-1)
console.log('\n=== FULL-FILE u16 (turn-1) intersection ===');
{
  const known = Object.entries(KNOWN);
  const firstFile = known[0][0];
  const firstBuf = load(firstFile);
  const firstTurnM1 = KNOWN[firstFile] - 1;
  let candidates = [];
  for (let i = 0; i + 2 <= firstBuf.length; i++) {
    if (firstBuf.readUInt16LE(i) === firstTurnM1) candidates.push(i);
    if (candidates.length > 200000) break;
  }
  console.log(`  first save (${firstFile}) has ${candidates.length} u16==${firstTurnM1} hits`);
  for (const [f, t] of known) {
    const b = load(f);
    const tm1 = t - 1;
    candidates = candidates.filter(off => b.length >= off + 2 && b.readUInt16LE(off) === tm1);
  }
  console.log(`  Survivors after intersecting all ${known.length} saves: ${candidates.length}`);
  for (const off of candidates.slice(0, 30)) {
    const row = known.map(([f, t]) => {
      const b = load(f);
      return `${f.split('.')[0].slice(0, 8)}=${b.readUInt16LE(off)}`;
    }).join(' ');
    console.log(`    0x${off.toString(16)}  ${row}`);
  }
}
