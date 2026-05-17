// At every stats_block offset, count how many DISTINCT discrete values appear
// across 83 settlements. Owner should have ~15-20 distinct values matching
// the major factions.

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
  const statsStart = nameOff - 583;
  const creator = buf.readUInt32LE(statsStart);
  if (creator >= 25) continue;
  settlements.push({
    name: readPstr16Utf16(buf, nameOff).str,
    statsStart,
    creator,
  });
}
console.log('Valid settlements: ' + settlements.length);

// Map "expected starting owner" for each settlement based on vanilla descr_strat
// (in 270 BC, before any captures)
const VANILLA_OWNER = {
  Arretium: 'julii', Ariminum: 'julii', Patavium: 'julii',
  Tarentum: 'brutii', Croton: 'brutii', Apollonia: 'brutii',
  Messana: 'scipii', Lilybaeum: 'scipii', Caralis: 'scipii',
  Rome: 'senate', Capua: 'senate',
  Carthage: 'carthage', Thapsus: 'carthage', Palma: 'carthage',
  Carthago_Nova: 'spain', Corduba: 'spain', Numantia: 'spain', Asturica: 'spain',
  Cirta: 'numidia', Tingi: 'numidia', Dimmidi: 'numidia', Siwa: 'numidia',
  Memphis: 'egypt', Thebes: 'egypt', Salamis: 'egypt', Jerusalem: 'egypt', Bostra: 'egypt',
  Tarsus: 'seleucid', Hatra: 'seleucid', Seleucia: 'seleucid', Damascus: 'seleucid', Sardis: 'seleucid',
  Susa: 'parthia', Arsakia: 'parthia',
  Mazaka: 'pontus',
  Bylazora: 'macedon', Larissa: 'macedon',
  Corinth: 'greek', Athens: 'greek', Pergamum: 'greek', Thermon: 'greek', Syracuse: 'greek',
  Tylis: 'thrace', Byzantium: 'thrace',
  Aquincum: 'dacia', Porrolissum: 'dacia',
  Tanais: 'scythia',
  Kotais: 'armenia', Phraaspa: 'armenia',
  Lugdunum: 'gauls', Massilia: 'gauls', Lemonum: 'gauls', Mediolanium: 'gauls', Narbo_Martius: 'gauls',
  Deva: 'britons', Eburacum: 'britons', Samarobriva: 'britons',
  Trier: 'germans', Mogontiacum: 'germans', Batavodurum: 'germans',
};

// For each offset, see if the values cluster by expected owner
console.log('\n=== Per-offset distinct-value count + faction grouping ===');
const promising = [];
for (let off = 0; off < 583 - 3; off += 4) {
  // Read value at this offset for each settlement
  const byOwner = {};
  for (const s of settlements) {
    const expectedOwner = VANILLA_OWNER[s.name];
    if (!expectedOwner) continue;
    if (!byOwner[expectedOwner]) byOwner[expectedOwner] = new Set();
    byOwner[expectedOwner].add(buf.readUInt32LE(s.statsStart + off));
  }
  // Compute consistency: how many factions have all their settlements share the same value?
  let consistentFactions = 0;
  for (const [owner, vals] of Object.entries(byOwner)) {
    if (vals.size === 1) consistentFactions++;
  }
  // Skip if all share same value (constant field, not owner)
  const allDistinct = new Set();
  for (const [owner, vals] of Object.entries(byOwner)) {
    for (const v of vals) allDistinct.add(v);
  }
  if (allDistinct.size < 5) continue;  // too few distinct values
  if (allDistinct.size > 30) continue;  // too noisy

  if (consistentFactions >= 8) {  // most factions internally consistent
    promising.push({ off, consistentFactions, distinct: allDistinct.size, byOwner });
  }
}

console.log('Found ' + promising.length + ' promising offsets');
promising.sort((a, b) => b.consistentFactions - a.consistentFactions);
for (const p of promising.slice(0, 10)) {
  console.log('\n  +' + p.off + ' (distinct=' + p.distinct + ', consistent factions=' + p.consistentFactions + '):');
  for (const [owner, vals] of Object.entries(p.byOwner)) {
    console.log('    ' + owner.padEnd(10) + ' values=' + Array.from(vals).slice(0, 5).join(','));
  }
}
