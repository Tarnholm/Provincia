const fs = require('fs');
const { findUnitRecords } = require('../src/unitParser.js');
const { findCharacterRecords } = require('../src/characterParser.js');
const { findAllSettlementMarkers } = require('../src/buildingParser.js');
const { findSettlementGovernors } = require('../src/saveOwnershipParser.js');

const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome3.sav';
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

console.log('save_rome3.sav size:', buf.length, 'mtime:', fs.statSync(path).mtime);

const roma = units.filter(u => u.region === 'Roma');
console.log('\nRoma units:', roma.length);
const cmdCount = {};
for (const u of roma) cmdCount['0x' + (u.commanderUuid || 0).toString(16)] = (cmdCount['0x' + (u.commanderUuid || 0).toString(16)] || 0) + 1;
console.log('Roma units by cmd:', cmdCount);

console.log('\nRome governor uuid:', gov['Rome'] ? '0x' + gov['Rome'].toString(16) : '(none)');
const romeGov = chars.find(c => c.secondaryUuid === gov['Rome']);
if (romeGov) {
  console.log('Rome governor v1 match: ' + romeGov.firstName + ' ' + (romeGov.lastName || ''));
} else {
  console.log('Rome governor v1 match: (UNRESOLVED — no v1 char with secondaryUuid 0x' + (gov['Rome']||0).toString(16) + ')');
}

const taras = units.filter(u => u.region === 'Taras');
console.log('\nTaras units:', taras.length);
const tarasCmdCount = {};
for (const u of taras) tarasCmdCount['0x' + (u.commanderUuid || 0).toString(16)] = (tarasCmdCount['0x' + (u.commanderUuid || 0).toString(16)] || 0) + 1;
console.log('Taras units by cmd:', tarasCmdCount);

const aulus = chars.find(c => c.firstName === 'Aulus');
if (aulus) console.log('\nAulus @0x' + aulus.offset.toString(16) + ' sec=0x' + (aulus.secondaryUuid||0).toString(16) + ' age=' + aulus.age + ' traits=' + aulus.traits.length);

// Show distinct regions in unit data
const regCount = {};
for (const u of units) regCount[u.region || '(none)'] = (regCount[u.region || '(none)'] || 0) + 1;
console.log('\nTotal regions with units:', Object.keys(regCount).length);
console.log('Top 15 regions by unit count:');
for (const [r, n] of Object.entries(regCount).sort((a,b)=>b[1]-a[1]).slice(0,15)) {
  console.log('  ' + r + ': ' + n);
}
