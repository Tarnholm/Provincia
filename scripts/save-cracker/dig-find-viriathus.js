// Search Spain T1 for Spanish character names directly

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

// Spanish characters from descr_strat
const names = [
  'Viriathus', 'Caraunios', 'Lucco', 'Matugenus',
  'Segovax', 'Rhetogenes',
  'Cartimandua', 'Esselta', 'Iseulta', 'Keynea',  // wives
  'Ambon', 'Leukon', 'Avaros', 'Verica',  // children
];

console.log('Looking for Spanish character names (UTF-16 LE and ASCII) in Spain T1...');
for (const name of names) {
  // UTF-16 LE search
  const utf16 = Buffer.alloc(name.length * 2);
  for (let i = 0; i < name.length; i++) utf16.writeUInt16LE(name.charCodeAt(i), i * 2);
  const u16Idx = T1.indexOf(utf16);

  // ASCII search
  const ascii = Buffer.from(name, 'ascii');
  const aIdx = T1.indexOf(ascii);

  console.log('  ' + name.padEnd(15) + ' UTF-16 @ ' + (u16Idx === -1 ? 'NOT FOUND' : '0x' + u16Idx.toString(16)) +
    '  ASCII @ ' + (aIdx === -1 ? 'NOT FOUND' : '0x' + aIdx.toString(16)));
}

// Look at the largest "person" data — characters are indexed by name pool.
// In vanilla, character names are stored as INDICES into descr_names_lookup.txt
// So I need to know the indices for these names. Let me see if I can find a name_index reference table.

// Actually let me just check if Spain T1 has the same "named character" structure as Arretium.
// Arretium had "roman general" pstr16 — that role string was for the GENERAL TYPE.
// Maybe Spain T1 has different role naming. Try "barbarian general" or "celtic general".
const altRoles = [
  'barbarian general', 'barbarian captain',
  'celtic general', 'celtic captain',
  'spain general', 'spain captain',
  'general', 'captain',
  'spanish general',
];
console.log('\nAlt role strings:');
for (const role of altRoles) {
  const target = Buffer.from(role + '\0', 'ascii');
  const idx = T1.indexOf(target);
  console.log('  "' + role + '": ' + (idx === -1 ? 'NOT FOUND' : '0x' + idx.toString(16)));
}

// Look for the standard character marker 03 00 00 00 00 00 00 00 (used in Alex saves)
const charMarker = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
let count = 0;
let p = 0;
while (true) {
  const idx = T1.indexOf(charMarker, p);
  if (idx === -1) break;
  count++;
  p = idx + 1;
}
console.log('\n0x03 0x00 0x00 0x00 + 4 zeros markers: ' + count);
