// Find building LEVEL names (construction queue items) inside settlement records

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const T11 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Known building LEVEL names from Alexander EDB
const buildingLevelNames = new Set([
  'blacksmith', 'smiths_workshop', 'foundry',
  'militia_barracks', 'city_barracks', 'army_barracks', 'royal_barracks',
  'wooden_pallisade', 'wooden_wall', 'stone_wall', 'large_stone_wall', 'epic_stone_wall',
  'trader', 'forum', 'great_forum',
  'village', 'town', 'large_town', 'city', 'large_city', 'huge_city',
  'governors_house', 'governors_villa', 'governors_palace', 'proconsuls_palace', 'imperial_palace',
  'port', 'shipwright', 'dockyard',
  'land_clearance', 'communal_farming', 'crop_rotation', 'irrigation',
  'roads', 'paved_roads', 'highways',
  'inn', 'coliseum_alehouse',
  'temple_of_horse_shrine', 'temple_of_horse_temple', 'temple_of_horse_large_temple',
  'temple_of_battle_shrine', 'temple_of_battle_temple', 'temple_of_battle_large_temple',
  'temple_of_war_shrine', 'temple_of_war_temple', 'temple_of_war_large_temple',
]);

function scan(buf, label) {
  console.log('\n=== ' + label + ' ===');
  const found = [];
  for (let p = 0x10000; p < 0x20000; p++) {
    const r = readPstr16Asciiz(buf, p);
    if (r && buildingLevelNames.has(r.str)) {
      found.push({ off: p, str: r.str });
    }
  }
  console.log('Building-level pstr16: ' + found.length);
  for (const f of found) console.log('  0x' + f.off.toString(16) + '  ' + f.str);
  return found;
}

const f11 = scan(T11, 'T11');
const f12 = scan(T12, 'T12');

console.log('\n=== Strings in T11 but not T12 ===');
const t12Set = new Set(f12.map(x => x.str));
for (const f of f11) if (!t12Set.has(f.str)) console.log('  T11 only: ' + f.str + ' @0x' + f.off.toString(16));

console.log('\n=== Strings in T12 but not T11 ===');
const t11Set = new Set(f11.map(x => x.str));
for (const f of f12) if (!t11Set.has(f.str)) console.log('  T12 only: ' + f.str + ' @0x' + f.off.toString(16));
