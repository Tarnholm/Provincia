// Validate character fields with CORRECTED offsets (+48 spouse, +56 age, +15 own_uuid)

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T0 = fs.readFileSync(path.join(BASE_R, 'save_macedon t0.sav'));

// Find role strings
const cultures = ['macedonian', 'greek', 'macedon', 'persian', 'roman', 'barbarian', 'eastern', 'egyptian', 'carthaginian'];
const roles = ['general', 'captain', 'diplomat', 'spy', 'assassin', 'admiral', 'merchant'];
let roleHits = [];
for (const c of cultures) {
  for (const r of roles) {
    const target = Buffer.from(c + ' ' + r + '\0', 'ascii');
    let p = 0;
    while (true) {
      const idx = T0.indexOf(target, p);
      if (idx === -1) break;
      roleHits.push({ off: idx, role: c + ' ' + r });
      p = idx + 1;
    }
  }
}

const namedChars = roleHits.filter(r => r.role.endsWith(' general') || r.role.endsWith(' captain') ||
                                          r.role.endsWith(' diplomat') || r.role.endsWith(' spy') ||
                                          r.role.endsWith(' admiral'));
console.log('Named character records: ' + namedChars.length);

// Read fields with CORRECTED offsets
console.log('\nFirst 30 named characters (corrected offsets):');
console.log('off      | role           | own_uuid   | bodyguard  | age | spouse_uuid');
let agesSeen = {};
for (const r of namedChars.slice(0, 50)) {
  const ownUuid = T0.readUInt32LE(r.off + 15);
  const bodyguard = T0.readUInt32LE(r.off + 19);
  // Find region pstr16 length, then skip over region to find spouse_uuid
  // Region length is at +33 (u16 LE chars). Region UTF-16 starts at +35. Region ends at +35 + 2*len.
  // Then ff ff ff ff sentinel (4 bytes). Then spouse_uuid (4 bytes).
  const regLen = T0.readUInt16LE(r.off + 33);
  if (regLen > 30) {
    console.log('  ' + r.off.toString(16) + ' ' + r.role + ': region length unreasonable (' + regLen + ')');
    continue;
  }
  const regionEnd = 35 + regLen * 2;
  // Sentinel should be at +regionEnd..+regionEnd+3
  const sentinel = T0.readUInt32LE(r.off + regionEnd);
  if (sentinel !== 0xffffffff) {
    // Maybe layout is slightly different — try the older +44 sentinel position
    // Use known-good positions for "X general" (13 char role): sentinel at +44, spouse at +48
  }
  // Spouse_uuid is at regionEnd + 4 (after sentinel)
  const spouseUuid = T0.readUInt32LE(r.off + regionEnd + 4);
  const age = T0.readUInt32LE(r.off + regionEnd + 12);  // after spouse_uuid + float
  console.log('  0x' + r.off.toString(16).padStart(7) + ' ' + r.role.padEnd(15) +
    ' uuid=0x' + ownUuid.toString(16).padStart(8, '0') +
    ' bg=0x' + bodyguard.toString(16).padStart(8, '0') +
    ' age=' + age.toString().padStart(3) +
    ' spouse=0x' + spouseUuid.toString(16).padStart(8, '0') +
    ' regLen=' + regLen);
  if (age >= 14 && age <= 80) agesSeen[age] = (agesSeen[age] || 0) + 1;
}

console.log('\nAges that appeared (count) — Macedon expected ~6 named chars: Alex 20, Adymos 41, Borus 44, Attalos 36, Assandros 23, Parmenion 40');
for (const [age, count] of Object.entries(agesSeen).sort((a, b) => parseInt(a) - parseInt(b))) {
  console.log('  age ' + age + ': ' + count);
}
