#!/usr/bin/env node
// Hunt for settlement records by the `default_set` ASCII marker (session 3 finding).
// Map settlement records in both saves and match them.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

function findCstr(buf, str) {
  const tok = Buffer.from(str + '\0');
  const hits = [];
  let pos = 0;
  while ((pos = buf.indexOf(tok, pos)) !== -1) {
    hits.push(pos);
    pos += 1;
  }
  return hits;
}

// Settlement structural markers per session 3:
// - "default_set" (1311 in rome save = total settlements)
// - "hinterland_region", "core_building", "governmentA/B/C/D"
// - "military_industrial_complex", "port_buildings", "town_walls", "theatres"
// - "hinterland_roads"

const markers = [
  'default_set',
  'hinterland_region',
  'core_building',
  'governmentA',
  'governmentB',
  'governmentC',
  'governmentD',
  'town_walls',
  'theatres',
  'port_buildings',
  'hinterland_roads',
  'temple_of_olympian',
  'temple_of_chthonic',
  'barracks',
  'archery_range',
  'stables',
  'shrine',
  'temple',
  'amphitheatres',
  'baths',
  'wonder',
  'sewers',
  'aqueduct',
  'roads',
  'farms',
  'mining',
  'trader',
  'market',
  'highway',
  'fortified',
  'core_castle_building',
  'caesars_imp_palace',
];

console.log('=== A (save_saveturn1start) ===');
for (const m of markers) {
  const hits = findCstr(A, m);
  if (hits.length > 0) console.log(`  ${m}: ${hits.length} hits`);
}

console.log('\n=== B (save_saveturn1construction) ===');
for (const m of markers) {
  const hits = findCstr(B, m);
  if (hits.length > 0) console.log(`  ${m}: ${hits.length} hits`);
}

// Difference in counts
console.log('\n=== Differences A vs B ===');
for (const m of markers) {
  const hA = findCstr(A, m).length;
  const hB = findCstr(B, m).length;
  if (hA !== hB) {
    console.log(`  ${m}: A=${hA}, B=${hB}, Δ=${hB-hA}`);
  }
}
