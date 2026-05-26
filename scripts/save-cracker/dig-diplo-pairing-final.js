// dig-diplo-pairing-final.js
//
// Final confirmation tests:
//  (1) Symmetry: if every relationship were stored twice (one per side), the
//      count of war-relations should be EVEN and each faction-pair appear in
//      both factions' lists. Quantify how many relations have NO partner.
//  (2) Section registry: is there a DIPLOMACY/RELATION section type that holds
//      a global {relationUuid -> factionA, factionB} table? Check the type
//      registry at 0x566 and scan for a section whose count == #relations.
//  (3) Definitive: for a KNOWN ground-truth major pair (acarnania<->aetolia
//      ALLY), is there ANY uuid in acarnania's list whose value or neighbor
//      reliably points to aetolia's record? (We already know NO direct field;
//      this just documents it.)

const fs = require('fs');
const X = require('../../src/saveCrackerExtras.js');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const buf = fs.readFileSync(SAVE);

function parseFactionOrder() {
  const txt = fs.readFileSync('C:/RIS/RIS/data/descr_sm_factions.txt', 'utf8');
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur && /^\s*"culture":/.test(line)) { order.push(cur); cur = null; }
  }
  return order;
}
const factionOrder = parseFactionOrder();
const recs = X.parseFactionTreasuries(buf);
const owners = X.identifyFactionRecordOwners(buf, recs, factionOrder);
const diplo = X.parseFactionDiplomacy(buf, recs);

// (1) Per-class totals across the 23 records
const byClass = {};
let total = 0;
for (const d of diplo) for (const r of d.relations) { byClass[r.class_] = (byClass[r.class_]||0)+1; total++; }
console.log('=== (1) Symmetry / parity ===');
console.log('total relations across 23 records:', total);
console.log('by class:', JSON.stringify(byClass), '(0=ally 1=cease 2=war 4=locked)');
console.log('NOTE: only 23 of', factionOrder.length, 'factions have records here.');
console.log('A relationship between a major and a NON-major faction can only be');
console.log('stored ONCE (in the major\'s list) since the partner has no record.');
console.log('=> odd parity is EXPECTED and pairing-by-symmetry is impossible.');

// How many relations could possibly be major<->major (both have a record)?
// We cannot know targets, but we can bound it: each major has a list; the
// MAXIMUM number of major<->major relationships is C(23,2)=253. Observed 283
// relations EXCEED what 23 majors can have among themselves, proving most
// targets are NON-major factions (not in our 23 records).
console.log('\nC(23,2) max intra-major pairs =', 23*22/2, ' but observed relations =', total);
console.log('=> majority of relation targets are NON-major factions w/o a class-100 record.');

// (2) Section type registry at 0x566
console.log('\n=== (2) Section type registry scan (0x566) ===');
function readRegistry(off) {
  // format: [u32 count][ASCIIZ name] repeated? Per memory note ID-based.
  // Just dump names that contain DIPLO/RELATION/ALLIANCE.
  const names = [];
  let p = off;
  for (let n = 0; n < 200 && p < buf.length - 8; n++) {
    const count = buf.readUInt32LE(p);
    p += 4;
    let s = '';
    while (p < buf.length && buf[p] !== 0 && s.length < 64) { s += String.fromCharCode(buf[p]); p++; }
    p++; // skip null
    if (!/^[A-Za-z_0-9]+$/.test(s)) break;
    names.push({ id: n, count, name: s });
  }
  return names;
}
const reg = readRegistry(0x566);
console.log('registry entries parsed:', reg.length);
for (const e of reg) {
  if (/DIPLO|RELAT|ALLIAN|WAR|TREAT|ATTITUDE|FACTION/i.test(e.name)) {
    console.log(`  id=${e.id} count=${e.count} name=${e.name}`);
  }
}
// Also list any section whose count is near 283 (#relations) or 239 (#factions)
console.log('\nSections with count near 283 (#relations) or matching #factions:');
for (const e of reg) {
  if (Math.abs(e.count - 283) <= 30 || e.count === 239 || e.count === 23) {
    console.log(`  id=${e.id} count=${e.count} name=${e.name}`);
  }
}

// (3) Document the no-direct-field result for acarnania<->aetolia
console.log('\n=== (3) acarnania (rec 11) vs aetolia (rec 15) ===');
const ri = owners.findIndex(o => o.factionName === 'acarnania');
const aj = owners.findIndex(o => o.factionName === 'aetolia');
console.log('acarnania record off=0x' + recs[ri].offset.toString(16) + ' uuid-field(+4)=0x' + buf.readUInt32LE(recs[ri].offset+4).toString(16));
console.log('aetolia   record off=0x' + recs[aj].offset.toString(16) + ' uuid-field(+4)=0x' + buf.readUInt32LE(recs[aj].offset+4).toString(16));
console.log('acarnania relations:', JSON.stringify(diplo[ri].relations.map(r=>r.uuid)));
console.log('aetolia   relations:', JSON.stringify(diplo[aj].relations.map(r=>r.uuid)));
console.log('shared uuids:', diplo[ri].relations.map(r=>r.uuid).filter(u => diplo[aj].relations.some(r=>r.uuid===u)));
