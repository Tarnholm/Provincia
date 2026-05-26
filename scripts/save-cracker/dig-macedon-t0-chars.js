// Find character records in Macedon T0 (Alex campaign) and verify:
//   - Alexander age 20, Adymos 41, Parmenion 40, Borus 44, Attalos 36, Assandros 23
//   - All characters: spouse_uuid is 0 or 0xffffffff (no marriages at game start)

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T0 = fs.readFileSync(path.join(BASE_A, 'save_macedon t0.sav'));

console.log('File size: ' + T0.length);

// Check campaign name to confirm this is alexander
const nameLen = T0.readUInt16LE(0x3a);
let name = '';
for (let i = 0; i < nameLen; i++) name += String.fromCharCode(T0.readUInt16LE(0x3c + i * 2));
console.log('Campaign name: "' + name + '"');

// Check for "macedon general", "greek general" role strings (Alex might use various culture prefixes)
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
console.log('\nRole strings found: ' + roleHits.length);
for (const r of roleHits.slice(0, 20)) console.log('  "' + r.role + '" @ 0x' + r.off.toString(16));

if (roleHits.length > 0) {
  console.log('\nPer-character: age@+57, spouse@+49:');
  for (const r of roleHits) {
    const age = T0.readUInt32LE(r.off + 57);
    const spouse = T0.readUInt32LE(r.off + 49);
    console.log('  "' + r.role + '" @0x' + r.off.toString(16) +
      '  age=' + age + '  spouse_uuid=0x' + spouse.toString(16));
  }
} else {
  console.log('No role strings — Alex T0 likely uses vanilla character format without inline role strings.');
  // Find character records via 03 00 00 00 00 00 00 00 marker
  const marker = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  let count = 0;
  let p = 0;
  while (true) {
    const idx = T0.indexOf(marker, p);
    if (idx === -1) break;
    count++;
    p = idx + 1;
  }
  console.log('Character marker occurrences: ' + count);
}
