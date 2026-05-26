// PRE save: all units have weapon=0. T4: some units have weapon=1.
// For EACH unit name position, find the soldier-array start by looking for
// where stride-9 reads are consistently 0x00 in PRE.
// Then check the same offset in T4 to see if any unit has weapon=0x04.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Find each unit name's position by ASCII pstr16 search
function findPstr16Asciiz(buf, name) {
  const lenP1 = name.length + 1;
  const target = Buffer.concat([
    Buffer.from([lenP1 & 0xff, (lenP1 >> 8) & 0xff]),
    Buffer.from(name, 'ascii'),
    Buffer.from([0])
  ]);
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

// Find each unit name in T4
const unitNames = ['roman hastati early', 'roman principes early', 'roman triarii early',
                   'roman equites early', 'roman rorarii', 'roman leves', 'aor etruscan spearmen'];

// For each unit, find the WEAPON BYTE by scanning offsets where ALL soldiers in PRE = 0x00.
// In T4, the same offset might be 0x00 (not upgraded) or 0x04 (upgraded).
function findWeaponOffset(buf, nameOff, soldierCount) {
  for (let off = 50; off < 400; off++) {
    let allZero = true;
    for (let i = 0; i < soldierCount; i++) {
      const p = nameOff + off + i * 9;
      if (p >= buf.length || buf[p] !== 0x00) { allZero = false; break; }
    }
    // Also require: bytes at off+1..off+4 (stride 9) are also 0x00 (next 4 stat positions)
    // AND bytes at off+5..off+8 are VARYING (UUID per soldier)
    if (!allZero) continue;
    // Verify the byte AT off+5..off+8 varies between soldiers
    const seen = new Set();
    for (let i = 0; i < Math.min(20, soldierCount); i++) {
      seen.add(buf.readUInt32LE(nameOff + off + 5 + i * 9));
    }
    if (seen.size < 10) continue; // not random enough
    return off;
  }
  return -1;
}

// For each unit type, find the FIRST occurrence in T4 (likely the player's main army)
console.log('Unit detection in T4 + soldier-array-start via PRE baseline:');
for (const name of unitNames) {
  const t4Positions = findPstr16Asciiz(T4, name);
  const prePositions = findPstr16Asciiz(PRE, name);
  console.log('\n=== ' + name + ' ===');
  console.log('  T4 positions: ' + t4Positions.length + ' (first 3: ' + t4Positions.slice(0, 3).map(p => '0x' + p.toString(16)).join(', ') + ')');
  console.log('  PRE positions: ' + prePositions.length + ' (first 3: ' + prePositions.slice(0, 3).map(p => '0x' + p.toString(16)).join(', ') + ')');

  // Try to find weapon offset using PRE (baseline=all zeros for these units)
  if (prePositions.length > 0) {
    // Try several soldier counts (60, 80, 122, 160, 200, 240)
    for (const sc of [60, 80, 122, 160, 200, 240]) {
      const off = findWeaponOffset(PRE, prePositions[0], sc);
      if (off >= 0) {
        console.log('  PRE weapon-offset candidate: +' + off + ' for ' + sc + ' soldiers');
        // Check T4 at the SAME offset for the same unit position (might have moved)
        if (t4Positions.length > 0) {
          for (const t4p of t4Positions.slice(0, 5)) {
            const vals = [];
            for (let i = 0; i < sc; i++) {
              const p = t4p + off + i * 9;
              if (p >= T4.length) break;
              vals.push(T4[p]);
            }
            const dist = {};
            for (const v of vals) dist[v] = (dist[v] || 0) + 1;
            const distStr = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => '0x' + parseInt(v).toString(16) + ':' + c).join(', ');
            console.log('    T4@0x' + t4p.toString(16) + ' weapon bytes (' + vals.length + ' soldiers): ' + distStr);
          }
        }
        break;
      }
    }
  }
}
