// Cluster all 66 named settlements by their back-pointer (at nameOff-29).
// If these pointers are faction-indexed, settlements with the same pointer
// belong to the same faction.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const peace = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) return null;
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

const defSets = findPstr16Asciiz(peace, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -20; step <= 0; step++) {
    const candidate = ds - 18 + step;
    if (candidate < 0) continue;
    const r = readPstr16Utf16(peace, candidate);
    if (r && r.totalLen === ds - candidate - 18) {
      nameOff = candidate;
      break;
    }
  }
  if (nameOff === -1) continue;
  const nameRec = readPstr16Utf16(peace, nameOff);
  const ptr = peace.readUInt32LE(nameOff - 29);
  settlements.push({ name: nameRec.str, nameOff, ptr });
}

// Cluster by ptr
const byPtr = {};
for (const s of settlements) {
  if (!byPtr[s.ptr]) byPtr[s.ptr] = [];
  byPtr[s.ptr].push(s.name);
}

console.log('=== Settlements grouped by back-pointer (0x14...) ===');
const sortedPtrs = Object.keys(byPtr).sort((a, b) => parseInt(a) - parseInt(b));
for (const p of sortedPtrs) {
  console.log('  0x' + parseInt(p).toString(16) + '  (' + byPtr[p].length + ' settlements): ' + byPtr[p].join(', '));
}

// Vanilla RTW 270 BC starting factions:
const VANILLA_OWNERSHIP = {
  romans_julii: ['Arretium', 'Ariminum', 'Patavium'],
  romans_brutii: ['Tarentum', 'Croton', 'Apollonia'],
  romans_scipii: ['Messana', 'Lilybaeum', 'Caralis'],
  romans_senate: ['Rome', 'Capua'],
  macedon: ['Bylazora', 'Larissa', 'Thessalonica'],
  greek_cities: ['Athens', 'Corinth', 'Sparta', 'Syracuse', 'Thermon', 'Rhodes'],
  thrace: ['Tylis', 'Byzantium', 'Campus_Getae'],
  dacia: ['Aquincum', 'Porrolissum', 'Campus_Iazyges'],
  scythia: ['Tanais', 'Campus_Sarmatae', 'Campus_Scythii'],
  parthia: ['Susa', 'Arsakia'],
  pontus: ['Mazaka', 'Sinope'],
  armenia: ['Kotais', 'Phraaspa', 'Artaxarta'],
  seleucid: ['Antioch', 'Damascus', 'Tarsus', 'Sardis', 'Hatra', 'Seleucia'],
  egypt: ['Memphis', 'Thebes', 'Alexandria', 'Cyrene', 'Salamis', 'Jerusalem'],
  numidia: ['Cirta', 'Dimmidi', 'Siwa', 'Nepte', 'Tingi'],
  carthage: ['Carthage', 'Palma', 'Caralis'],
  spain: ['Carthago_Nova', 'Corduba', 'Numantia', 'Asturica', 'Scallabis', 'Osca'],
  gauls: ['Alesia', 'Lemonum', 'Lugdunum', 'Massilia', 'Mediolanum', 'Burdigala'],
  britons: ['Deva', 'Eburacum', 'Londinium', 'Cammulodunon'],
  germans: ['Trier', 'Lovosice', 'Hatvan', 'Damme'],
};

console.log('\n=== Settlement → faction prediction (based on vanilla RTW 270 BC) ===');
for (const p of sortedPtrs) {
  const settlementsInGroup = byPtr[p];
  // Find which vanilla faction this group matches
  const matches = {};
  for (const fac of Object.keys(VANILLA_OWNERSHIP)) {
    let count = 0;
    for (const s of settlementsInGroup) {
      if (VANILLA_OWNERSHIP[fac].includes(s)) count++;
    }
    if (count > 0) matches[fac] = count;
  }
  const bestMatch = Object.entries(matches).sort((a, b) => b[1] - a[1])[0];
  if (bestMatch) {
    console.log('  0x' + parseInt(p).toString(16) + '  → ' + bestMatch[0] + ' (' + bestMatch[1] + '/' + settlementsInGroup.length + ' match): ' + settlementsInGroup.join(', '));
  } else {
    console.log('  0x' + parseInt(p).toString(16) + '  → UNKNOWN: ' + settlementsInGroup.join(', '));
  }
}
