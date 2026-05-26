// Check unit-level stat aggregate slots (3x 14-byte blocks before soldier array)
// for weapon/armor/exp upgrades.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BEFORE = fs.readFileSync(path.join(BASE_R, 'save_before armor upgrade queue.sav'));
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

// For each unit instance, look at the 14-byte slots BEFORE the soldier array.
// Pattern: `01 00 40 00 XX 00 00 00 00 00 00 00 00 00` repeating 3 times.
// We're looking for the level byte at slot+4. Find the unit type's soldier-array-start
// offset, then back up 3*14 = 42 bytes for the stat slots.

const unitTypes = ['roman hastati early', 'roman principes early', 'roman triarii early',
                   'roman equites early', 'roman leves', 'roman rorarii', 'aor etruscan spearmen'];

// Scan for the 14-byte slot pattern in each unit
function findStatSlots(buf, p, soldierArrayOff) {
  // Stat slots are 3x 14-byte blocks immediately BEFORE soldier array.
  // Pattern: 01 00 40 00 XX 00 00 00 00 00 00 00 00 00 (XX = level × 4)
  // So find positions where buf[off] == 0x01, buf[off+1] == 0x00, buf[off+2] == 0x40, buf[off+3] == 0x00
  // and buf[off+5..+13] are mostly zeros.
  const slots = [];
  for (let off = soldierArrayOff - 50; off < soldierArrayOff; off++) {
    if (buf[p + off] === 0x01 && buf[p + off + 1] === 0x00 &&
        buf[p + off + 2] === 0x40 && buf[p + off + 3] === 0x00) {
      slots.push({ off, level: buf[p + off + 4] });
    }
  }
  return slots;
}

// Find the soldier-array-start for each unit by looking for stride-9 weapon pattern
function findSoldierArrayStart(buf, p) {
  // Look for offset where stride-9 reads are constant 0x04 (weapon level 1) or 0x00
  // The starting offset of the array is just before the FIRST uniform stat byte position
  for (let off = 50; off < 500; off++) {
    let same = true;
    for (let i = 1; i < 20; i++) {
      if (buf[p + off + i * 9] !== buf[p + off]) { same = false; break; }
    }
    if (same && (buf[p + off] === 0x04 || buf[p + off] === 0x00)) {
      return off;
    }
  }
  return -1;
}

console.log('Unit-level stat slot dump for retrained units:');
for (const type of unitTypes) {
  const posBefore = findAllAscii(BEFORE, type);
  const posNext = findAllAscii(NEXT_T, type);
  console.log('\n--- ' + type + ' ---');
  for (let i = 0; i < Math.min(posBefore.length, posNext.length, 10); i++) {
    const pB = posBefore[i], pN = posNext[i];
    const arrayB = findSoldierArrayStart(BEFORE, pB);
    const arrayN = findSoldierArrayStart(NEXT_T, pN);
    if (arrayB < 0 || arrayN < 0) continue;
    // Check stat slots
    const slotsB = findStatSlots(BEFORE, pB, arrayB);
    const slotsN = findStatSlots(NEXT_T, pN, arrayN);
    if (slotsB.length > 0 || slotsN.length > 0) {
      const sB = slotsB.map(s => '@+' + s.off + ':L' + (s.level / 4)).join(', ');
      const sN = slotsN.map(s => '@+' + s.off + ':L' + (s.level / 4)).join(', ');
      const diff = slotsN.reduce((a, b) => a + b.level, 0) - slotsB.reduce((a, b) => a + b.level, 0);
      const tag = diff !== 0 ? '  ← LEVEL CHANGED ' + (diff > 0 ? '+' : '') + diff : '';
      console.log('  unit ' + i + ' (B@0x' + pB.toString(16) + ', N@0x' + pN.toString(16) + ', sB=' + slotsB.length + ', sN=' + slotsN.length + ')');
      if (slotsB.length > 0) console.log('    BEFORE slots: ' + sB);
      if (slotsN.length > 0) console.log('    NEXT slots:   ' + sN + tag);
    }
  }
}
