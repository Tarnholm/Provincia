// dig-diplo-pairing-baseline.js
//
// Goal: establish the ground state for the relationUuid -> target-faction
// mapping problem on save_macedon t0.sav.
//
// 1. Parse the 23 class-100 faction records and identify their owners.
// 2. For each record, dump the diplomacy entries (uuid/class/attitude/tag).
// 3. Dump the record HEADER bytes (look for a faction-level UUID near the
//    self-pointers) so we can later test "relationUuid == target record's
//    faction-uuid".
// 4. Build descr_strat ground-truth pairs and compare counts.

const fs = require('fs');
const path = require('path');
const X = require('../../src/saveCrackerExtras.js');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const DSTRAT = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';

const buf = fs.readFileSync(SAVE);

// ---- faction order from descr_sm_factions (same logic as main.js) ----
function parseFactionOrder() {
  const p = 'C:/RIS/RIS/data/descr_sm_factions.txt';
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
  const order = [];
  let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) {
      const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/);
      if (cm) { order.push(cur); cur = null; }
    }
  }
  return order;
}

const factionOrder = parseFactionOrder();
console.log('factionOrder count:', factionOrder ? factionOrder.length : 'NULL');

const recs = X.parseFactionTreasuries(buf);
console.log('class-100 records:', recs.length);

const owners = X.identifyFactionRecordOwners(buf, recs, factionOrder);
const diplo = X.parseFactionDiplomacy(buf, recs);

console.log('\n=== Record owners + diplo summary ===');
for (let i = 0; i < recs.length; i++) {
  const o = owners[i];
  const d = diplo[i];
  const rels = d.relations || [];
  const wars = rels.filter(r => r.class_ === 2).length;
  const allies = rels.filter(r => r.class_ === 0 || r.class_ === 4).length;
  console.log(
    `rec[${String(i).padStart(2)}] off=0x${recs[i].offset.toString(16)} faction=${(o.factionName||'?').padEnd(18)} fid=${recs[i].factionId} regions=${recs[i].regionCount} rels=${rels.length} wars=${wars} allies=${allies}`
  );
}

// ---- Dump header bytes of each record to hunt for a faction-level UUID ----
console.log('\n=== Record header dumps (first 0x40 bytes, plus around region tail) ===');
function hex(slice) {
  return Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
}
for (let i = 0; i < Math.min(recs.length, 4); i++) {
  const off = recs[i].offset;
  console.log(`-- rec[${i}] ${owners[i].factionName} @0x${off.toString(16)} --`);
  for (let r = 0; r < 0x40; r += 16) {
    console.log(`  +${String(r).padStart(3)} ${hex(buf.slice(off + r, off + r + 16))}`);
  }
}

// ---- Aggregate stats over all relationUuids ----
let allUuids = [];
let totWar = 0, totAlly = 0, totCease = 0, totLocked = 0;
const tagSet = new Set();
const attSet = new Set();
for (let i = 0; i < diplo.length; i++) {
  for (const r of (diplo[i].relations || [])) {
    allUuids.push(r.uuid);
    if (r.class_ === 2) totWar++;
    else if (r.class_ === 0) totAlly++;
    else if (r.class_ === 1) totCease++;
    else if (r.class_ === 4) totLocked++;
    tagSet.add(r.tag);
    attSet.add(r.attitude);
  }
}
console.log('\n=== Aggregate ===');
console.log('total relations:', allUuids.length);
console.log('distinct uuids:', new Set(allUuids).size);
console.log('class counts: war=' + totWar, 'ally=' + totAlly, 'cease=' + totCease, 'locked=' + totLocked);
console.log('distinct tags:', [...tagSet].map(t => '0x' + t.toString(16)).join(', '));
console.log('distinct attitudes:', [...attSet].sort((a,b)=>a-b).join(', '));
const sortedU = [...allUuids].sort((a,b)=>a-b);
console.log('uuid range:', sortedU[0], '..', sortedU[sortedU.length-1]);

// ---- descr_strat ground truth (non-slave relations) ----
function parseGroundTruth() {
  const txt = fs.readFileSync(DSTRAT, 'latin1');
  const lines = txt.split(/\r?\n/);
  const pairs = []; // {from, to, value, kind}
  for (const line of lines) {
    const m = line.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1], value = parseInt(m[2], 10), to = m[3];
    if (to === 'slave') continue; // global war vs rebels, skip for pairing test
    const kind = value <= 199 ? 'ally' : (value === 200 ? 'neutral' : 'war');
    pairs.push({ from, to, value, kind });
  }
  return pairs;
}
const gt = parseGroundTruth();
console.log('\n=== descr_strat ground truth (non-slave) ===');
console.log('declarations:', gt.length);
const gtAlly = gt.filter(p => p.kind === 'ally').length;
const gtWar = gt.filter(p => p.kind === 'war').length;
console.log('ally decls:', gtAlly, ' war decls:', gtWar);

// Restrict to the 23 major factions present in the save.
const majorNames = new Set(owners.map(o => o.factionName).filter(Boolean));
console.log('\nmajor factions in save:', [...majorNames].sort().join(', '));
const gtAmongMajors = gt.filter(p => majorNames.has(p.from) && majorNames.has(p.to));
console.log('GT decls among the 23 majors:', gtAmongMajors.length);
for (const p of gtAmongMajors) console.log('  ' + p.from + ' -> ' + p.to + ' (' + p.value + ' ' + p.kind + ')');
