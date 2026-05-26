// Find ARMOR_LVL byte by diffing pre-armor-upgrade vs after-armor-upgrade saves.
// Same A/B method that found weapon_lvl at byte +0 of each 9-byte soldier record.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BEFORE = fs.readFileSync(path.join(BASE_R, 'save_before armor upgrade queue.sav'));
const AFTER_Q = fs.readFileSync(path.join(BASE_R, 'save_after amour upgrade queue.sav'));
const NEXT_T = fs.readFileSync(path.join(BASE_R, 'save_next turn, armour upgraded..sav'));

console.log('File sizes:');
console.log('  BEFORE:      ' + BEFORE.length);
console.log('  AFTER queue: ' + AFTER_Q.length + ' (+' + (AFTER_Q.length - BEFORE.length) + ')');
console.log('  NEXT turn:   ' + NEXT_T.length + ' (+' + (NEXT_T.length - AFTER_Q.length) + ')');

// Strategy: in BEFORE the armor-upgraded units should match NEXT_TURN's same units
// EXCEPT for the armor byte. Compare BEFORE vs NEXT_T for the same hastati unit.
// (One was retrained earlier with weapon+1, now also armor+1.)

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

// Find Arretium unit name positions. The retrained hastati was at name+146 = first soldier
// in T4. After 2 more turns and armor upgrade, the unit should still be findable.
const hastatiBefore = findAllAscii(BEFORE, 'roman hastati early');
const hastatiNext = findAllAscii(NEXT_T, 'roman hastati early');
console.log('\nHastati positions:');
console.log('  BEFORE: ' + hastatiBefore.length + ' @ first 5: ' + hastatiBefore.slice(0, 5).map(p => '0x' + p.toString(16)).join(', '));
console.log('  NEXT:   ' + hastatiNext.length + ' @ first 5: ' + hastatiNext.slice(0, 5).map(p => '0x' + p.toString(16)).join(', '));

// For each pair (hastatiBefore[i], hastatiNext[i]), compare bytes at +146 with stride 9
// for 122 soldiers. Find which byte position consistently flips (likely armor).
console.log('\n=== Compare hastati pair (each unit) across BEFORE vs NEXT turn ===');
for (let i = 0; i < Math.min(hastatiBefore.length, hastatiNext.length); i++) {
  const b = hastatiBefore[i];
  const n = hastatiNext[i];
  // Skip if size mismatch
  if (b === undefined || n === undefined) continue;
  // Tally byte-position diffs within hastati's range (+146 to +1500 for 122 soldiers × 9 bytes ~= 1098 bytes)
  const counts = {};
  for (let dx = 146; dx < 146 + 122 * 9; dx++) {
    const bv = BEFORE[b + dx];
    const nv = NEXT_T[n + dx];
    if (bv === undefined || nv === undefined) continue;
    if (bv === nv) continue;
    const mod = (dx - 146) % 9;
    if (!counts[mod]) counts[mod] = { plus4: 0, other: 0, examples: [] };
    if (bv === 0x00 && nv === 0x04) counts[mod].plus4++;
    else if (bv === 0x04 && nv === 0x04) {} // weapon was already at +0, unchanged
    else counts[mod].other++;
    if (counts[mod].examples.length < 3) counts[mod].examples.push({ dx, bv, nv });
  }
  console.log('\nUnit ' + i + ' (BEFORE @0x' + b.toString(16) + ', NEXT @0x' + n.toString(16) + '):');
  for (const mod of Object.keys(counts).sort((a, b) => parseInt(a) - parseInt(b))) {
    const c = counts[mod];
    console.log('  byte +' + mod + ' of soldier record: ' + c.plus4 + ' "0→4" flips, ' + c.other + ' other changes');
  }
}

// Also: compute the global diff between BEFORE and NEXT to find ALL byte positions
// that go 0→4 (likely armor upgrades on multiple soldiers) vs random differences.
console.log('\n=== Global pattern check: BEFORE vs NEXT ===');
const minLen = Math.min(BEFORE.length, NEXT_T.length);
let strideHits = {};
// Just scan the relevant zone (army zone in T4 was 0x1537000..0x154c000;
// for NEXT_T which is 2 turns later it might have shifted +1MB or so).
// Find the army zone in NEXT_T via the first hastati name.
if (hastatiNext.length > 0) {
  const armyStart = hastatiNext[0] - 0x10000;
  const armyEnd = hastatiNext[hastatiNext.length - 1] + 0x10000;
  console.log('Scanning NEXT_T zone 0x' + armyStart.toString(16) + '..0x' + armyEnd.toString(16));
  // We can't easily diff BEFORE vs NEXT byte-by-byte because the file shifted.
  // But we know: ALL retrained units in BEFORE had weapon=0x04, armor=0x00.
  // In NEXT_T after armor upgrade, those should have weapon=0x04, armor=0x04.
  // Count occurrences of "0x04 0x04" pattern (weapon + armor) in NEXT_T's army zone
  // vs BEFORE's army zone.
  let beforeCount = 0;
  let nextCount = 0;
  for (let p = 0x1500000; p < 0x1700000 && p < BEFORE.length - 2; p++) {
    if (BEFORE[p] === 0x04 && BEFORE[p + 1] === 0x04) beforeCount++;
  }
  for (let p = 0x1500000; p < 0x1700000 && p < NEXT_T.length - 2; p++) {
    if (NEXT_T[p] === 0x04 && NEXT_T[p + 1] === 0x04) nextCount++;
  }
  console.log('  "0x04 0x04" (weapon+armor side-by-side) BEFORE: ' + beforeCount + ', NEXT: ' + nextCount);
}
