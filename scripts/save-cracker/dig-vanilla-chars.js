// Find vanilla Rome's character section. Search for known character names
// from descr_strat (vanilla RTW Spanish starting characters: Caro, Indibilis,
// Cidanna, etc.) and characters from other factions.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Spanish starting characters in vanilla RTW
const SPAIN_CHARS = ['Indibilis', 'Caro', 'Cidanna', 'Mandonius'];
// Carthage starting characters
const CARTHAGE_CHARS = ['Hamilcar', 'Hannibal', 'Hasdrubal', 'Mago', 'Bomilcar', 'Himilco'];
// Roman starting characters
const ROMAN_CHARS = ['Marius', 'Pompey', 'Caesar', 'Cato', 'Cicero', 'Crassus'];

const ALL = [...SPAIN_CHARS, ...CARTHAGE_CHARS, ...ROMAN_CHARS];

function findUtf16(buf, str) {
  const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}

console.log('=== Search for known character names (UTF-16) ===');
for (const name of ALL) {
  const hits = findUtf16(peace, name);
  if (hits.length > 0) {
    console.log('  "' + name + '": ' + hits.length + ' hits at ' + hits.slice(0, 3).map(o => '0x' + o.toString(16)).join(', '));
  }
}

// Also search for ASCII versions
console.log('\n=== ASCII versions ===');
for (const name of ALL) {
  const needle = Buffer.from(name);
  const hits = [];
  let p = 0;
  while ((p = peace.indexOf(needle, p)) !== -1) {
    hits.push(p);
    p++;
  }
  if (hits.length > 0) {
    console.log('  "' + name + '": ' + hits.length + ' hits at ' + hits.slice(0, 3).map(o => '0x' + o.toString(16)).join(', '));
  }
}

// Find the first character record area by searching for ANY common name pattern.
// Vanilla RTW characters typically have ASCII names like "Marcus", "Lucius", etc.
console.log('\n=== Common Latin/Roman name search ===');
const COMMON_NAMES = ['Marcus', 'Lucius', 'Gaius', 'Quintus', 'Aulus', 'Publius', 'Decimus', 'Tiberius'];
for (const name of COMMON_NAMES) {
  const hits = findUtf16(peace, name);
  if (hits.length > 0) {
    console.log('  "' + name + '" (UTF-16): ' + hits.length + ' hits, first 3: ' + hits.slice(0, 3).map(o => '0x' + o.toString(16)).join(', '));
  }
}
