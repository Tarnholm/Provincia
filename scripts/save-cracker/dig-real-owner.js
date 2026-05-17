// Find the REAL owner field (not the creator at +0).
// Group settlements by expected vanilla owner. Find u32 offsets where
// all of Spain's 4 vanilla cities share the same value.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  settlements.push({
    name: readPstr16Utf16(buf, nameOff).str,
    nameOff,
    statsStart: nameOff - 583,  // forced
  });
}

// Vanilla starting ownership groups (descr_strat-derived)
const OWNERSHIP = {
  spain: ['Carthago_Nova', 'Corduba', 'Numantia', 'Asturica'],
  carthage: ['Carthage', 'Thapsus', 'Caralis', 'Palma', 'Lilybaeum'],
  romans_brutii: ['Tarentum', 'Croton', 'Apollonia'],
  romans_julii: ['Arretium', 'Ariminum', 'Patavium'],
  romans_scipii: ['Messana', 'Capua', 'Caralis'],  // Caralis varies
  romans_senate: ['Rome'],
  macedon: ['Bylazora', 'Larissa', 'Thessalonica'],
  egypt: ['Memphis', 'Thebes', 'Alexandria', 'Cyrene', 'Salamis', 'Jerusalem'],
  seleucid: ['Antioch', 'Damascus', 'Tarsus', 'Sardis', 'Hatra', 'Seleucia'],
  parthia: ['Susa', 'Arsakia'],
  pontus: ['Mazaka', 'Sinope'],
  gauls: ['Alesia', 'Lemonum', 'Lugdunum', 'Massilia', 'Mediolanium', 'Narbo_Martius'],
  britons: ['Deva', 'Eburacum', 'Samarobriva'],
  germans: ['Trier', 'Mogontiacum', 'Batavodurum', 'Vicus_Marcomannii'],
  numidia: ['Cirta', 'Tingi', 'Dimmidi', 'Siwa'],
  scythia: ['Tanais', 'Campus_Sarmatae', 'Campus_Alanni'],
  greek_cities: ['Athens', 'Sparta', 'Syracuse', 'Thermon', 'Halicarnasus', 'Corinth', 'Pergamum'],
  thrace: ['Tylis', 'Byzantium', 'Campus_Getae'],
  dacia: ['Aquincum', 'Porrolissum', 'Campus_Iazyges'],
  armenia: ['Kotais', 'Phraaspa', 'Artaxarta'],
};

// For each u32 offset, check if all of Spain's 4 cities share the same value
// AND no other faction's cities share that value
console.log('=== Hunt for OWNER field across stats block u32 offsets ===');

const spainNames = OWNERSHIP.spain;
const candidates = [];
for (let off = 0; off < 583 - 3; off += 4) {
  // Get values for Spain's cities
  const spainVals = [];
  for (const name of spainNames) {
    const s = settlements.find(x => x.name === name);
    if (!s) continue;
    spainVals.push({ name, v: buf.readUInt32LE(s.statsStart + off) });
  }
  if (spainVals.length < 3) continue;
  // All Spain cities must share the same value (within 1, allowing for noise)
  const unique = new Set(spainVals.map(x => x.v));
  if (unique.size !== 1) continue;
  const spainVal = spainVals[0].v;
  // Must be a plausible small int
  if (spainVal > 50000) continue;
  candidates.push({ off, spainVal, spainCities: spainVals });
}

console.log('Found ' + candidates.length + ' offsets where all Spain cities share the same value');
for (const c of candidates) {
  console.log('\n  +' + c.off + ': Spain val = ' + c.spainVal);
  // Check what other factions have at this offset
  for (const [fac, names] of Object.entries(OWNERSHIP)) {
    if (fac === 'spain') continue;
    const facVals = [];
    for (const name of names) {
      const s = settlements.find(x => x.name === name);
      if (!s) continue;
      facVals.push({ name, v: buf.readUInt32LE(s.statsStart + c.off) });
    }
    if (facVals.length === 0) continue;
    const facUnique = new Set(facVals.map(x => x.v));
    const distinct = facUnique.size === 1 ? facVals[0].v : '(' + Array.from(facUnique).join('/') + ')';
    console.log('    ' + fac.padEnd(15) + ' (' + facVals.length + ' cities): ' + distinct);
  }
}
