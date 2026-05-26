// Find children references in character records.
// Approach 1: invert fatherUuid (each father's children are characters whose fatherUuid = his own_uuid)
// Approach 2: scan the father's record AFTER the bodyguard for children UUIDs

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Find all character records via role strings
const cultures = ['roman', 'greek', 'barbarian', 'eastern', 'egyptian', 'carthaginian'];
const roles = ['general', 'captain', 'diplomat', 'spy', 'assassin', 'admiral', 'merchant'];
const characters = [];
for (const c of cultures) {
  for (const r of roles) {
    const target = Buffer.from(c + ' ' + r + '\0', 'ascii');
    let p = 0;
    while (true) {
      const idx = T4.indexOf(target, p);
      if (idx === -1) break;
      // Read all the fields
      const regLen = T4.readUInt16LE(idx + 35);
      if (regLen < 1 || regLen > 30) { p = idx + 1; continue; }
      let region = '';
      for (let j = 0; j < regLen; j++) region += String.fromCharCode(T4.readUInt16LE(idx + 37 + j * 2));
      const postRegion = idx + 37 + regLen * 2;
      const spouse = T4.readUInt32LE(postRegion + 4);
      const age = T4.readUInt32LE(postRegion + 12);
      const ownUuid = T4.readUInt32LE(idx + 15);
      const bodyguard = T4.readUInt32LE(idx + 19);
      characters.push({ off: idx, role: c + ' ' + r, region, regLen, ownUuid, bodyguard, spouse, age, postRegion });
      p = idx + 1;
    }
  }
}
console.log('Total characters: ' + characters.length);

// Build maps
const byUuid = new Map();
for (const c of characters) byUuid.set(c.ownUuid, c);

// Print each character with spouse linkage resolved
console.log('\nCharacters with spouse linkage resolved:');
for (const c of characters) {
  const spouseChar = byUuid.get(c.spouse);
  const spouseInfo = spouseChar ? `→ ${spouseChar.role} @ 0x${spouseChar.off.toString(16)}` :
    (c.spouse === 0 || c.spouse === 0xffffffff ? 'unmarried' : '→ external/non-role uuid 0x' + c.spouse.toString(16));
  console.log('  ' + c.role.padEnd(15) + ' @ 0x' + c.off.toString(16) +
    ' uuid=0x' + c.ownUuid.toString(16) + ' age=' + c.age + ' region="' + c.region + '" spouse:' + spouseInfo);
}

// Now look INSIDE one general's record AFTER the bodyguard to find children references.
// New husband (no children expected) at 0x153cc99 vs an EXISTING general with kids.
// Each soldier in the bodyguard is 9 bytes. General bodyguard has typically 16-64 soldiers.
// Look from +120 onwards in the record to see what's there.

console.log('\n=== Bodyguard array end + post-bodyguard scan for the new husband ===');
const husband = characters.find(c => c.off === 0x153cc99);
if (husband) {
  // Compute bodyguard array start (after unit stat slots which are 3x14 bytes)
  const statsStart = husband.postRegion + 16; // After spouse, float, age, age2 (16 bytes)
  const bgArrayStart = statsStart + 42;  // 3 × 14-byte stat slots
  console.log('Husband ' + (husband.region) + ' UUID 0x' + husband.ownUuid.toString(16));
  console.log('postRegion=0x' + husband.postRegion.toString(16) + ' statsStart=0x' + statsStart.toString(16) + ' bgArrayStart=0x' + bgArrayStart.toString(16));
  // Dump 200 bytes from bgArrayStart onwards
  console.log('Bytes from bgArrayStart:');
  for (let j = 0; j < 200; j += 32) {
    const hex = Array.from(T4.slice(bgArrayStart + j, bgArrayStart + j + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(bgArrayStart + j, bgArrayStart + j + 32)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
  }
}
