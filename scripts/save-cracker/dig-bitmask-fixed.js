// Bitmask is at name_end+19 (u8 count), preceded by 3 constant bytes "9c c7 06" at name_end+16

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const saves = [
  { name: 'PRE',       path: path.join(BASE_R, 'save_arretium pre retrained..sav') },
  { name: 'Spain-T1',  path: path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav') },
  { name: 'Spain-T2',  path: path.join(BASE_R, 'save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav') },
  { name: 'Alex-T1',   path: path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav') },
  { name: 'Alex-T11',  path: path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav') },
];

const bufs = saves.map(s => ({ name: s.name, buf: fs.readFileSync(s.path) }));

const FACTION_NAMES_VANILLA = [
  'romans_julii', 'romans_brutii', 'romans_scipii', 'romans_senate', 'egypt',
  'seleucid', 'carthage', 'parthia', 'gauls', 'germania',
  'britons', 'greek_cities', 'macedon', 'pontus', 'armenia',
  'dacia', 'thrace', 'numidia', 'spain', 'scythia', 'slave'
];

function decodeBitmask(buf) {
  const nameLen = buf.readUInt16LE(0x3a);
  const nameEnd = 0x3c + nameLen * 2;
  // 3 constant bytes at name_end+16
  const c1 = buf[nameEnd + 16];
  const c2 = buf[nameEnd + 17];
  const c3 = buf[nameEnd + 18];
  const count = buf[nameEnd + 19];  // u8
  const bitmask = buf.slice(nameEnd + 20, nameEnd + 20 + count);
  const bits = [];
  for (let i = 0; i < count; i++) {
    for (let bit = 0; bit < 8; bit++) bits.push((bitmask[i] >> bit) & 1);
  }
  return { c1, c2, c3, count, bitmask, bits, start: nameEnd + 20 };
}

console.log('=== Bitmask decode for each save ===');
for (const b of bufs) {
  const bm = decodeBitmask(b.buf);
  console.log('\n' + b.name + ':');
  console.log('  constants @ name_end+16..18: ' + bm.c1.toString(16) + ' ' + bm.c2.toString(16) + ' ' + bm.c3.toString(16));
  console.log('  count @ name_end+19: ' + bm.count + ' bytes');
  console.log('  bitmask hex: ' + Array.from(bm.bitmask).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('  bits: ' + bm.bits.join(''));
  console.log('  popcount: ' + bm.bits.filter(b => b).length);
  const setIdx = [];
  for (let i = 0; i < bm.bits.length; i++) if (bm.bits[i]) setIdx.push(i);
  console.log('  set bit indices: [' + setIdx.join(',') + ']');
  // Annotate with faction names
  if (b.name.startsWith('Spain') && bm.count === 3) {
    const annotated = setIdx.map(i => i + '=' + (FACTION_NAMES_VANILLA[i] || '?')).join(', ');
    console.log('  set bits → factions: ' + annotated);
  }
}
