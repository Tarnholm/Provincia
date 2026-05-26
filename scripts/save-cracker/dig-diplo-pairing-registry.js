// dig-diplo-pairing-registry.js
//
// Read the section-type registry (located ~0x3310 for RIS Macedon T0) to see
// if a DIPLOMACY / RELATION / FACTION_ECONOMICS section exists that could hold
// a global relationUuid->faction mapping. Also confirm FACTION_ECONOMICS count
// (memory says 36, but parseFactionTreasuries finds only 23).

const fs = require('fs');
const X = require('../../src/saveCrackerExtras.js');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const buf = fs.readFileSync(SAVE);

function readRegistry(buf) {
  let p = 0x500;
  while (p < 0x10000) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && end < nameStart + 60 && /^[A-Z][A-Z_0-9]*$/.test(buf.slice(nameStart, end).toString('latin1'))) break;
      }
    }
    p++;
  }
  const startP = p;
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end < 0 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString('latin1');
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, name, count });
    p = end + 1;
  }
  return { startP, types };
}

const { startP, types } = readRegistry(buf);
console.log('registry start: 0x' + startP.toString(16) + '  entries:', types.length);
console.log('\n=== Section types matching diplo/faction/relation/attitude ===');
for (const t of types) {
  if (/DIPLO|RELAT|ALLIAN|WAR|TREAT|ATTITUDE|FACTION/i.test(t.name)) {
    console.log(`  id=${t.id} count=${String(t.count).padStart(5)} ${t.name}`);
  }
}
console.log('\n=== ALL section types ===');
for (const t of types) console.log(`  id=${String(t.id).padStart(3)} count=${String(t.count).padStart(6)} ${t.name}`);

// Compare to what parseFactionTreasuries finds
const recs = X.parseFactionTreasuries(buf);
console.log('\nparseFactionTreasuries finds', recs.length, 'class-100 (+44=6) records.');

// How many records share the broader class-100 signature (+8=100,+12=1) but with +44 != 6?
let broad = 0, by44 = {};
for (let i = 0; i + 96 < buf.length; i++) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  broad++;
  const v44 = buf.readUInt32LE(i + 44);
  by44[v44] = (by44[v44] || 0) + 1;
}
console.log('broad class-100 records (self-ptr verified):', broad);
console.log('breakdown by +44 value:', JSON.stringify(by44));
