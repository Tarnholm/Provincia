// Spanish settlements in vanilla RTW: Asturica, Numantia, Carthago_Nova, Corduba,
// Pallantia, Salamantica. Find them in the save and use their positions to
// pin Spain's faction-block in the diplomatic table.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

const SETTLEMENTS = {
  spain: ['Asturica', 'Numantia', 'Carthago_Nova', 'Corduba', 'Pallantia', 'Salamantica'],
  carthage: ['Carthage', 'Caralis', 'Palma', 'Thapsus', 'Lilybaeum', 'Tingi', 'Dimmidi', 'Lepcis_Magna', 'Sicca'],
  numidia: ['Cirta', 'Siwa', 'Bulla_Regia'],
  egypt: ['Alexandria', 'Memphis', 'Thebes', 'Jerusalem'],
  romans_julii: ['Arretium', 'Ariminum', 'Patavium', 'Croton'],
};

function findUtf16(buf, str) {
  const needle = Buffer.from([...str].flatMap(c => [c.charCodeAt(0), 0]));
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { hits.push(p); p++; }
  return hits;
}

console.log('=== Find UTF-16 settlement names ===');
for (const [faction, settlements] of Object.entries(SETTLEMENTS)) {
  console.log('\nFaction: ' + faction);
  for (const s of settlements) {
    const hits = findUtf16(peace, s);
    if (hits.length > 0) {
      console.log('  "' + s + '" (UTF-16): ' + hits.length + ' hits, first: 0x' + hits[0].toString(16));
    }
  }
}

// For each settlement that's found, also dump the surrounding 64 bytes to see
// what else is there
console.log('\n=== Carthago_Nova context (Spain capital) ===');
const cnHits = findUtf16(peace, 'Carthago_Nova');
if (cnHits.length > 0) {
  const p = cnHits[0];
  const start = Math.max(0, p - 32);
  const end = Math.min(peace.length, p + 64);
  for (let o = start; o < end; o += 16) {
    const slice = peace.subarray(o, Math.min(o + 16, end));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}
