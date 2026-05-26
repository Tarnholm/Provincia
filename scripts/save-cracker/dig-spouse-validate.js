// Validate spouse UUID and age fields against Spain T1 ground truth.
// Spain has 4 generals with known ages and spouses.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

// Spain uses 'barbarian general' role strings most likely (Spain is barbarian culture)
function findAllRoles(buf) {
  const out = [];
  const cultures = ['roman', 'greek', 'barbarian', 'eastern', 'egyptian', 'carthaginian', 'spanish'];
  const roles = ['general', 'captain', 'diplomat', 'spy', 'assassin', 'admiral', 'merchant'];
  for (const c of cultures) {
    for (const r of roles) {
      const target = Buffer.from(c + ' ' + r + '\0', 'ascii');
      let p = 0;
      while (true) {
        const idx = buf.indexOf(target, p);
        if (idx === -1) break;
        out.push({ off: idx, role: c + ' ' + r, len: target.length });
        p = idx + 1;
      }
    }
  }
  return out;
}

const all = findAllRoles(T1);
console.log('All role strings in Spain T1: ' + all.length);
const byRole = {};
for (const r of all) byRole[r.role] = (byRole[r.role] || 0) + 1;
console.log('Role distribution: ' + JSON.stringify(byRole));

// Look at the spain general records
const spainGens = all.filter(r => r.role.includes('general') || r.role.includes('captain'));
console.log('\nSpain generals/captains: ' + spainGens.length);

// For each general, read +49 (spouse_uuid) and +57 (age)
console.log('\nPer-general data (role / age@+57 / spouse_uuid@+49):');
for (let i = 0; i < spainGens.length; i++) {
  const r = spainGens[i];
  const age = T1.readUInt32LE(r.off + 57);
  const spouseUuid = T1.readUInt32LE(r.off + 49);
  const ownUuid = T1.readUInt32LE(r.off + 16);
  console.log('  ' + i + ' "' + r.role + '" @0x' + r.off.toString(16) +
    ' age=' + age + ' ownUuid=0x' + ownUuid.toString(16) +
    ' spouseUuid=0x' + spouseUuid.toString(16));
}

// Expected Spanish generals: Viriathus age 60, Caraunios 40, Lucco 30, Matugenus 25
// Match by age!
console.log('\n=== Match against descr_strat (Viriathus 60, Caraunios 40, Lucco 30, Matugenus 25) ===');
const expectedAges = [60, 40, 30, 25];
for (const exp of expectedAges) {
  const match = spainGens.find(r => T1.readUInt32LE(r.off + 57) === exp);
  if (match) {
    console.log('  age ' + exp + ': MATCH ' + match.role + ' @0x' + match.off.toString(16));
  } else {
    console.log('  age ' + exp + ': NOT FOUND at +57');
  }
}
