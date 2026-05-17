// Verify u32@0x2c5e1 is Spain's treasury — check across all Spain saves

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));

console.log('=== u32@0x2c5e1 across ALL Spain saves ===');
console.log('save                                                               year  u32@0x2c5e1');
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE, f));
  if (0x2c5e1 + 4 > buf.length) continue;
  const v = buf.readUInt32LE(0x2c5e1);
  const year = buf.readInt32LE(0x514);
  console.log('  ' + f.substring(0, 60).padEnd(62) + '  ' + year + '  ' + v);
}

// Also try nearby offsets (in case 0x2c5e1 isn't quite right)
console.log('\n=== Nearby offsets (0x2c5dd..0x2c5e9) ===');
const offs = [0x2c5dd, 0x2c5e1, 0x2c5e5];
for (const off of offs) {
  console.log('\nu32@0x' + off.toString(16) + ':');
  for (const f of allFiles.slice(0, 6)) {
    const buf = fs.readFileSync(path.join(BASE, f));
    if (off + 4 > buf.length) continue;
    const v = buf.readUInt32LE(off);
    console.log('  ' + f.substring(0, 60) + ': ' + v);
  }
}

// EDB construction times for buildings
console.log('\n=== EDB construction times (vanilla imperial campaign) ===');
const VANILLA_EDB = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\export_descr_buildings.txt';
const edb = fs.readFileSync(VANILLA_EDB, 'utf-8');

// Parse: find each building level + its "construction N" line
const lines = edb.split('\n');
let currentBuilding = null;
let currentLevel = null;
const constructionTimes = {};
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const buildMatch = line.match(/^building\s+(\S+)/);
  if (buildMatch) {
    currentBuilding = buildMatch[1];
    if (!constructionTimes[currentBuilding]) constructionTimes[currentBuilding] = {};
    continue;
  }
  // Look for a level definition: "<level_name> requires factions..."
  const levelMatch = line.match(/^\s+(\w+)\s+requires/);
  if (levelMatch) {
    currentLevel = levelMatch[1];
    continue;
  }
  // Look for "construction N"
  const constMatch = line.match(/^\s+construction\s+(\d+)/);
  if (constMatch && currentLevel && currentBuilding) {
    constructionTimes[currentBuilding][currentLevel] = parseInt(constMatch[1]);
  }
}

console.log('\nBuilding construction times (turns, vanilla EDB):');
for (const [bldg, levels] of Object.entries(constructionTimes)) {
  if (Object.keys(levels).length === 0) continue;
  console.log('  ' + bldg + ':');
  for (const [lvl, turns] of Object.entries(levels)) {
    console.log('    ' + lvl.padEnd(30) + ' ' + turns + ' turns');
  }
  if (Object.keys(levels).length > 8) console.log('    ...');
}
