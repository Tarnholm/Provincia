// Different unit types have different header sizes. Find the weapon byte
// for each unit by looking for a position where stride-9 reads are CONSISTENTLY 0x04
// (or constant value for upgraded units, 0x00 for non-upgraded).

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// For each unit, scan offsets 50..500 from name, and find the offset where
// stride-9 reads give a CONSISTENT value (all 0x00 or all 0x04) across N soldiers.
function findWeaponOffset(nameOff, soldierCount, label) {
  console.log('\n=== ' + label + ' @ 0x' + nameOff.toString(16) + ' (' + soldierCount + ' soldiers) ===');
  for (let off = 50; off < 400; off++) {
    const values = [];
    for (let i = 0; i < soldierCount; i++) {
      const p = nameOff + off + i * 9;
      if (p >= T4.length) break;
      values.push(T4[p]);
    }
    if (values.length < soldierCount) continue;
    // Check if all the same value
    const unique = new Set(values);
    if (unique.size === 1) {
      const v = values[0];
      // Only report if interesting (not 0xff which is padding, and skip 0x00 unless it's clearly the case)
      if (v === 0x04 || v === 0x08 || v === 0x0c || v === 0x01 || v === 0x02 || v === 0x03 ||
          (v === 0x00 && soldierCount > 50)) {
        console.log('  offset +' + off + ': ALL ' + soldierCount + ' soldiers = 0x' + v.toString(16));
      }
    }
  }
}

findWeaponOffset(0x1547146, 122, 'Hastati 1 (retrained, weapon+1)');
findWeaponOffset(0x15479d1, 122, 'Hastati 2 (not retrained)');
findWeaponOffset(0x154ac18, 80, 'New aor etruscan spearmen (Arretium recruit)');

// Also do a diff between hastati 1 and hastati 2 to find ALL byte positions
// (in soldier records) that consistently differ.
console.log('\n=== Hastati pair: all byte positions where weapon-1 vs weapon-0 ===');
const positions = [];
for (let off = 0; off < 1500; off++) {
  const a = T4[0x1547146 + off];
  const b = T4[0x15479d1 + off];
  if (a === 0x04 && b === 0x00) positions.push(off);
}
console.log('Found ' + positions.length + ' positions where h1=0x04 AND h2=0x00');
// Show stride-9 groupings
if (positions.length > 0) {
  // Find first position
  const first = positions[0];
  console.log('First position: +' + first);
  // Check stride
  const strides = [];
  for (let i = 1; i < Math.min(20, positions.length); i++) {
    strides.push(positions[i] - positions[i-1]);
  }
  console.log('First 19 strides: [' + strides.join(', ') + ']');
}
