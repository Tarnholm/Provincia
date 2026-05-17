// Extract EDB tier mapping for Alexander campaign
// Then check which Sparta buildings could be upgraded

const fs = require('fs');

const EDB_PATH = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\alexander\\data\\export_descr_buildings.txt';

const edb = fs.readFileSync(EDB_PATH, 'utf-8');

// Parse: lines starting with "building <category>" then "levels <tier0> <tier1> ..."
const lines = edb.split('\n');
const buildingTiers = {};
let currentBuilding = null;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const buildMatch = line.match(/^building\s+(\S+)/);
  if (buildMatch) {
    currentBuilding = buildMatch[1];
    continue;
  }
  const levelsMatch = line.match(/^\s*levels\s+(.+?)\s*$/);
  if (levelsMatch && currentBuilding) {
    const tiers = levelsMatch[1].split(/\s+/).filter(t => t.length > 0);
    buildingTiers[currentBuilding] = tiers;
    currentBuilding = null;
  }
}

console.log('=== Alexander EDB tier mapping ===');
for (const [name, tiers] of Object.entries(buildingTiers)) {
  console.log('  ' + name.padEnd(25) + ' (' + tiers.length + ' tiers): ' + tiers.join(', '));
}

// Now apply to Sparta's buildings
console.log('\n=== Sparta interpretation ===');
const SPARTA = [
  ['core_building', 4],
  ['defenses', 2],
  ['barracks', 1],
  ['equestrian', 2],
  ['missiles', 1],
  ['market', 3],
  ['smith', 0],
  ['port_buildings', 1],
  ['hinterland_farms', 3],
  ['hinterland_roads', 0],
  ['academic', 0],
  ['despotic_law', 2],
  ['temple_of_one_god', 4],
];

for (const [bldg, tier] of SPARTA) {
  const levels = buildingTiers[bldg];
  if (!levels) { console.log('  ' + bldg + '/t' + tier + ' [no EDB info]'); continue; }
  const current = levels[tier] || '???';
  const next = levels[tier + 1];
  const isMax = tier >= levels.length - 1;
  const maxStr = isMax ? ' (MAX)' : (next ? ' → upgradeable to: ' + next : '');
  console.log('  ' + bldg.padEnd(20) + '/t' + tier + ' = ' + current + maxStr);
}
