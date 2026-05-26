// Better approach:
// 1. BEFORE→AFTER_QUEUE (+225 bytes) — the queue insertion (just like the +200 byte retrain queue)
// 2. AFTER_QUEUE→NEXT_TURN — the upgrade completes; one unit's soldiers gain armor
// Compare BEFORE (retrained hastati at +146 weapon=0x04, armor=0x00) vs NEXT_TURN
// (same retrained hastati now should have weapon=0x04, armor=0x?? at byte +1)

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BEFORE = fs.readFileSync(path.join(BASE_R, 'save_before armor upgrade queue.sav'));
const AFTER_Q = fs.readFileSync(path.join(BASE_R, 'save_after amour upgrade queue.sav'));
const NEXT_T = fs.readFileSync(path.join(BASE_R, 'save_next turn, armour upgraded..sav'));

function findAllAscii(buf, str) {
  const target = Buffer.from(str + '\0', 'ascii');
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(target, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

// In BEFORE, find the unit with weapon byte = 0x04 across all soldiers.
// This is the retrained hastati from the earlier session.
const hastatiBefore = findAllAscii(BEFORE, 'roman hastati early');
const hastatiNext = findAllAscii(NEXT_T, 'roman hastati early');

console.log('Looking for the hastati with weapon=0x04 (retrained one) in each save...');

function findRetrainedHastati(buf, positions, label) {
  console.log('\n' + label + ':');
  for (const p of positions) {
    // Check byte +146 with stride 9 across 122 soldiers — if all 0x04, it's the retrained one
    let allFour = true;
    for (let i = 0; i < 122; i++) {
      if (buf[p + 146 + i * 9] !== 0x04) { allFour = false; break; }
    }
    if (allFour) {
      console.log('  RETRAINED hastati @ 0x' + p.toString(16) + ' (122 soldiers all weapon=0x04)');
      return p;
    }
  }
  console.log('  No fully-retrained hastati found at +146 stride 9');
  return -1;
}

const before = findRetrainedHastati(BEFORE, hastatiBefore, 'BEFORE');
const next = findRetrainedHastati(NEXT_T, hastatiNext, 'NEXT_TURN');

if (before > 0 && next > 0) {
  // Now check what byte at +1, +2, +3, +4 of each soldier record looks like
  // in BEFORE vs NEXT_T. The byte that flips from 0x00 to 0x04 (or whatever) is armor.
  console.log('\n=== Per-byte-position values across 122 soldiers ===');
  for (let pos = 0; pos < 9; pos++) {
    const bDist = {}, nDist = {};
    for (let i = 0; i < 122; i++) {
      const bv = BEFORE[before + 146 + i * 9 + pos];
      const nv = NEXT_T[next + 146 + i * 9 + pos];
      bDist[bv] = (bDist[bv] || 0) + 1;
      nDist[nv] = (nDist[nv] || 0) + 1;
    }
    const bStr = Object.entries(bDist).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v, c]) => '0x' + parseInt(v).toString(16) + ':' + c).join(', ');
    const nStr = Object.entries(nDist).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v, c]) => '0x' + parseInt(v).toString(16) + ':' + c).join(', ');
    const flipped = (Object.keys(bDist).length === 1 && Object.keys(nDist).length === 1 && bDist !== nDist) ? '   *** FLIPPED ***' : '';
    console.log('  byte +' + pos + ': BEFORE [' + bStr + ']  →  NEXT [' + nStr + ']' + flipped);
  }
}

// Also diff BEFORE vs AFTER_QUEUE (the +225 byte queue insertion)
console.log('\n\n=== Queue insertion location (BEFORE vs AFTER_QUEUE) ===');
const SHIFT = AFTER_Q.length - BEFORE.length;
console.log('Total shift: ' + SHIFT);
let firstDivergeArea = -1;
for (let p = 0x1500000; p < BEFORE.length - 8; p++) {
  let ok = true;
  for (let k = 0; k < 8; k++) if (BEFORE[p + k] !== AFTER_Q[p + SHIFT + k]) { ok = false; break; }
  if (ok) {
    // Walk forward to find first BEFORE byte that doesn't match aligned AFTER_Q
    for (let q = p; q < BEFORE.length - 8; q++) {
      let alignedOk = true;
      for (let k = 0; k < 32; k++) if (BEFORE[q + k] !== AFTER_Q[q + k]) { alignedOk = false; break; }
      if (!alignedOk) {
        firstDivergeArea = q;
        break;
      }
    }
    break;
  }
}
// Actually simpler: just compare from 0x1540000 onwards for first divergence
let firstDiff = -1;
for (let p = 0x1540000; p < BEFORE.length - 4; p++) {
  if (BEFORE[p] !== AFTER_Q[p]) { firstDiff = p; break; }
}
console.log('First diff after 0x1540000: 0x' + firstDiff.toString(16));

// Dump the inserted bytes
if (firstDiff > 0) {
  const startInQ = firstDiff;
  // Find re-alignment after shift
  let endShift = -1;
  for (let s = 1; s <= 500; s++) {
    let match = true;
    for (let k = 0; k < 32; k++) {
      if (BEFORE[firstDiff + k] !== AFTER_Q[firstDiff + s + k]) { match = false; break; }
    }
    if (match) { endShift = s; break; }
  }
  if (endShift > 0) {
    console.log('Re-aligns after shift=' + endShift + ' (= inserted ' + endShift + ' bytes)');
    console.log('Inserted bytes in AFTER_QUEUE at 0x' + firstDiff.toString(16) + ':');
    for (let j = 0; j < endShift + 16; j += 16) {
      const len = Math.min(16, endShift - j);
      const hex = Array.from(AFTER_Q.slice(firstDiff + j, firstDiff + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(AFTER_Q.slice(firstDiff + j, firstDiff + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
      console.log('  +' + j + ': ' + hex + '  |' + ascii + '|');
    }
  }
}
