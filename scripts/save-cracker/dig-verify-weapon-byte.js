// Verify weapon_lvl byte position by checking ALL soldiers in both hastati
// AND the new etruscan spearmen unit.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// HASTATI 1 (retrained) name @ 0x1547146. Weapon byte appears at +155 with stride 9.
// So weapon bytes at 0x1547146+155, +164, +173, ... = 0x15471e1, 0x15471ea, ...
// HASTATI 2 (not retrained) name @ 0x15479d1. Same relative offset would be +155.

function readWeaponBytes(nameOff, soldierCount, label) {
  const FIRST_WEAPON_OFFSET = 155;
  const STRIDE = 9;
  console.log('\n=== ' + label + ' weapon bytes ===');
  const values = [];
  for (let i = 0; i < soldierCount; i++) {
    const p = nameOff + FIRST_WEAPON_OFFSET + i * STRIDE;
    if (p >= T4.length) break;
    values.push(T4[p]);
  }
  // Distribution
  const dist = {};
  for (const v of values) dist[v] = (dist[v] || 0) + 1;
  console.log('  total soldiers read: ' + values.length);
  console.log('  value distribution: ' + Object.entries(dist).map(([v, c]) => '0x' + parseInt(v).toString(16) + ':' + c).join(', '));
  console.log('  first 30: ' + values.slice(0, 30).map(v => '0x' + v.toString(16)).join(' '));
  console.log('  last 10:  ' + values.slice(-10).map(v => '0x' + v.toString(16)).join(' '));
  return values;
}

readWeaponBytes(0x1547146, 122, 'Hastati 1 (retrained)');
readWeaponBytes(0x15479d1, 122, 'Hastati 2 (NOT retrained)');
readWeaponBytes(0x154ac18, 80, 'New aor etruscan spearmen (Arretium recruit)');

// Try a few other unit positions to see what their weapon levels look like
readWeaponBytes(0x1540ca5, 200, 'Roman principes early (first occurrence)');
readWeaponBytes(0x154602c, 200, 'Roman principes early (second occurrence)');
readWeaponBytes(0x153a741, 160, 'Roman leves (first occurrence)');
