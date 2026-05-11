const fs = require('fs');
const { findUnitRecords } = require('../src/unitParser.js');
const { findCharacterRecords } = require('../src/characterParser.js');
const { findAllSettlementMarkers } = require('../src/buildingParser.js');
const { findSettlementGovernors } = require('../src/saveOwnershipParser.js');

const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome4.sav';
const buf = fs.readFileSync(path);

const lookup = fs.readFileSync('C:/RIS/RIS/data/descr_names_lookup.txt','utf8').split(/\r?\n/).map(s=>s.trim());
const traitNames = [];
for (const line of fs.readFileSync('C:/RIS/RIS/data/export_descr_character_traits.txt','utf8').split(/\r?\n/)) {
  const m = line.match(/^Trait\s+(\S+)/);
  if (m) traitNames.push(m[1]);
}

const units = findUnitRecords(buf);
const settlements = findAllSettlementMarkers(buf);
const gov = findSettlementGovernors(buf, settlements, -1940);
const chars = findCharacterRecords(buf, lookup, traitNames, null);

console.log('save_rome4 size:', buf.length, 'mtime:', fs.statSync(path).mtime.toISOString());
console.log('total chars (v1):', chars.length, 'units:', units.length);

console.log('\n=== Brundisium / Calabria ===');
const calabria = units.filter(u => u.region === 'Calabria');
console.log('Calabria units:', calabria.length);
const cmdCount = {};
for (const u of calabria) cmdCount['0x' + (u.commanderUuid || 0).toString(16)] = (cmdCount['0x' + (u.commanderUuid || 0).toString(16)] || 0) + 1;
console.log('  by cmd:', cmdCount);
console.log('  Brundisium governor uuid:', gov['Brundisium'] ? '0x' + gov['Brundisium'].toString(16) : '(none)');

console.log('\n=== All units in Calabria (file order, with cmd & inferred attribution) ===');
// Replicate main.js's foot-attribution
const ordered = units.slice().sort((a, b) => a.offset - b.offset);
let lastCmd = null, lastRegion = null;
for (const u of ordered) {
  if (u.commanderUuid) { lastCmd = u.commanderUuid; lastRegion = u.region || null; continue; }
  if (!u.region || !lastCmd || u.region !== lastRegion) continue;
  u.inferredCmd = lastCmd;
}
for (const u of calabria) {
  console.log('  @0x' + u.offset.toString(16), u.name.padEnd(28), 'cmd=0x' + (u.commanderUuid || 0).toString(16).padStart(8, '0'), 'inferred=0x' + (u.inferredCmd || 0).toString(16).padStart(8, '0'), u.soldiers + '/' + u.maxSoldiers);
}

console.log('\n=== Find Marcus Livius_Drusus character record ===');
const marcus = chars.filter(c => c.firstName === 'Marcus' && c.lastName && c.lastName.includes('Livius'));
console.log('matches:', marcus.length);
for (const c of marcus) console.log('  @0x' + c.offset.toString(16) + ' ' + c.firstName + ' ' + c.lastName + ' age=' + c.age + ' sec=0x' + (c.secondaryUuid || 0).toString(16) + ' traits=' + c.traits.length);

// Also look for any character with Livius_Drusus
const livius = chars.filter(c => c.lastName && c.lastName.includes('Livius'));
console.log('\nAll Livius* chars:', livius.length);
for (const c of livius) console.log('  @0x' + c.offset.toString(16) + ' ' + c.firstName + ' ' + c.lastName);

// Find Marcus Livius_Drusus's bodyguard
console.log('\n=== Marcus Livius_Drusus bodyguard search ===');
console.log('Marcus uuid: 0x4004587a');
const marcusUnits = units.filter(u => u.commanderUuid === 0x4004587a);
console.log('Units with cmd=0x4004587a:', marcusUnits.length);
for (const u of marcusUnits) console.log('  @0x' + u.offset.toString(16) + ' ' + u.name + ' region=' + u.region + ' ' + u.soldiers + '/' + u.maxSoldiers);

// All roman general units
console.log('\n=== All roman general units ===');
const rg = units.filter(u => u.name === 'roman general');
console.log('Roman generals:', rg.length);
for (const u of rg) console.log('  @0x' + u.offset.toString(16) + ' region=' + u.region + ' cmd=0x' + (u.commanderUuid || 0).toString(16).padStart(8, '0') + ' ' + u.soldiers + '/' + u.maxSoldiers);

console.log('\n=== All units in Salentinia (Uria) ===');
const sal = units.filter(u => u.region === 'Salentinia');
console.log('count:', sal.length);
for (const u of sal) console.log('  @0x' + u.offset.toString(16) + ' ' + u.name.padEnd(28) + ' cmd=0x' + (u.commanderUuid || 0).toString(16).padStart(8, '0') + ' ' + u.soldiers + '/' + u.maxSoldiers);

console.log('\n=== All units in Taras (Tarentum) ===');
const tar = units.filter(u => u.region === 'Taras');
console.log('count:', tar.length);
for (const u of tar) console.log('  @0x' + u.offset.toString(16) + ' ' + u.name.padEnd(28) + ' cmd=0x' + (u.commanderUuid || 0).toString(16).padStart(8, '0') + ' ' + u.soldiers + '/' + u.maxSoldiers);

console.log('\n=== Find Titus character record ===');
const tituses = chars.filter(c => c.firstName === 'Titus');
console.log('Titus chars:', tituses.length);
for (const c of tituses.slice(0, 10)) console.log('  @0x' + c.offset.toString(16) + ' ' + c.firstName + ' ' + (c.lastName || '(none)') + ' age=' + c.age + ' sec=0x' + (c.secondaryUuid || 0).toString(16) + ' traits=' + c.traits.length + ' isLeader=' + c.isLeader);
