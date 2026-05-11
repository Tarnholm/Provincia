#!/usr/bin/env node
// Look at all 6 saves for Pella's building chain list, and the 53-byte construction insert.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const saves = [
  'save_saveturn1start.sav',
  'save_saveturn1building.sav',
  'save_saveturn1construction.sav',
  'save_saveturn1move.sav',
  'save_saveturn2start.sav',
  'save_Noarmiesmovedturn1.sav',
];

const pellaUtf16 = Buffer.from('Pella', 'utf16le');

// Known sub-record names
const knownNames = [
  'default_set', 'hinterland_region', 'core_building', 'core_castle_building',
  'governmentA', 'governmentB', 'governmentC', 'governmentD', 'governmentE',
  'town_walls', 'theatres', 'port_buildings', 'hinterland_roads',
  'barracks', 'archery_range', 'stables', 'shrine', 'temple',
  'amphitheatres', 'baths', 'wonder', 'sewers', 'aqueduct',
  'hinterland_farms', 'roads', 'farms',
  'mining', 'trader', 'market', 'merchants',
  'highway', 'fortified', 'gateway',
  'caesars_imp_palace', 'military_industrial_complex',
  'defenses', 'missiles', 'health', 'cavalry',
  'guilds', 'wonders',
  'temple_of_olympian', 'temple_of_chthonic', 'temple_of_governors',
  'temple_of_apollo', 'temple_of_zeus', 'temple_of_ares', 'temple_of_athena',
];

for (const s of saves) {
  const buf = fs.readFileSync(path.join(dir, s));
  const pName = buf.indexOf(pellaUtf16);
  if (pName < 0) { console.log(`${s}: no Pella`); continue; }
  console.log(`\n=== ${s} (Pella @ 0x${pName.toString(16)}) ===`);
  // Find all sub-records in Pella+0..+3500
  const subs = [];
  for (const name of knownNames) {
    let pos = pName;
    while (pos < pName + 3500) {
      const tok = Buffer.from(name + '\0');
      const hit = buf.indexOf(tok, pos);
      if (hit < 0 || hit > pName + 3500) break;
      // Verify nameLen at hit-2
      const nameLen = buf.readUInt16LE(hit - 2);
      if (nameLen === name.length) {
        subs.push({ name, hit, rel: hit - pName });
      }
      pos = hit + 1;
    }
  }
  subs.sort((a, b) => a.rel - b.rel);
  for (const s2 of subs) {
    console.log(`  +${s2.rel.toString().padStart(4)}: "${s2.name}"`);
  }
}
