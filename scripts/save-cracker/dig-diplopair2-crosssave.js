// dig-diplopair2-crosssave.js
//
// ANGLE 4: cross-save diff. Between consecutive turns, if a faction gains ONE
// new relation, the new entry has the highest uuid (global creation counter).
// If we can pair the new uuid in faction A's zone with a new uuid in faction
// B's zone (the other party), we learn whether relationships are stored on
// both sides and whether any field links the two new entries.
//
// We diff each fixture pair: list per-faction zone DELTAS (added/removed uuids),
// and look for symmetric additions: faction A added uuid Ua (class war), and
// some faction B ALSO added a war uuid in the SAME turn => candidate partners.

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const DIR = 'C:/dev/Provincia/scripts/save-cracker/fixtures/feral/';
const fo = L.parseFactionOrder();

function loadZones(file) {
  const buf = fs.readFileSync(DIR + file);
  return { buf, zones: L.dedupZones(L.parseZones(buf, fo)) };
}

function zoneMap(zones) {
  const m = new Map();
  for (const z of zones) m.set(z.fid, z);
  return m;
}

function diff(fileA, fileB) {
  console.log(`\n================ DIFF ${fileA} -> ${fileB} ================`);
  let A, B;
  try { A = loadZones(fileA); B = loadZones(fileB); }
  catch (e) { console.log('  load error:', e.message); return; }
  const ma = zoneMap(A.zones), mb = zoneMap(B.zones);
  console.log(`zonesA=${A.zones.length} zonesB=${B.zones.length}`);
  // global new uuids
  const uuidsA = new Set(); for (const z of A.zones) for (const r of z.relations) uuidsA.add(r.uuid);
  const uuidsB = new Set(); for (const z of B.zones) for (const r of z.relations) uuidsB.add(r.uuid);
  const added = [...uuidsB].filter(u => !uuidsA.has(u)).sort((a, b) => a - b);
  const removed = [...uuidsA].filter(u => !uuidsB.has(u)).sort((a, b) => a - b);
  console.log(`global added uuids: ${added.length}  removed: ${removed.length}`);
  console.log('max uuid A:', uuidsA.size ? Math.max(...uuidsA) : '-', ' max uuid B:', uuidsB.size ? Math.max(...uuidsB) : '-');

  // For each added uuid, which faction zone holds it in B, and its class/att?
  const addedInfo = [];
  for (const z of B.zones) for (const r of z.relations) if (added.includes(r.uuid)) addedInfo.push({ uuid: r.uuid, fid: z.fid, name: fo[z.fid], cls: r.class_, att: r.attitude });
  addedInfo.sort((a, b) => a.uuid - b.uuid);
  console.log('\nADDED relations (faction that gained them):');
  for (const a of addedInfo) console.log(`  uuid=${a.uuid} ${a.name}(fid${a.fid}) cls=${a.cls} att=${a.att}`);

  // Per-faction count change
  console.log('\nPer-faction relation-count change:');
  const allFids = new Set([...ma.keys(), ...mb.keys()]);
  for (const fid of [...allFids].sort((x, y) => x - y)) {
    const ca = ma.has(fid) ? ma.get(fid).count : 0;
    const cb = mb.has(fid) ? mb.get(fid).count : 0;
    if (ca !== cb) console.log(`  ${(fo[fid] || '#' + fid).padEnd(18)} fid${fid}: ${ca} -> ${cb} (${cb - ca > 0 ? '+' : ''}${cb - ca})`);
  }

  // KEY: if exactly two factions each gained exactly one relation of the same
  // class in the same turn, they are likely the two parties. Report such cases.
  const gained = [];
  for (const fid of allFids) {
    const za = ma.get(fid), zb = mb.get(fid);
    const ua = new Set(za ? za.relations.map(r => r.uuid) : []);
    const newOnes = (zb ? zb.relations : []).filter(r => !ua.has(r.uuid));
    for (const r of newOnes) gained.push({ fid, name: fo[fid], uuid: r.uuid, cls: r.class_, att: r.attitude });
  }
  // group by class and look for reciprocal pairs (two factions, same class, close uuids)
  console.log('\nReciprocal-candidate analysis (factions that gained relations):');
  const byClass = {};
  for (const g of gained) { (byClass[g.cls] = byClass[g.cls] || []).push(g); }
  for (const cls of Object.keys(byClass)) {
    const list = byClass[cls].sort((a, b) => a.uuid - b.uuid);
    console.log(`  class ${cls}: ${list.map(g => `${g.name}#${g.uuid}`).join('  ')}`);
  }
}

// Republic of Rome turns 1->2, 2->? (only have t1e,t2s,t5,t11s,t11e)
diff('ror_t1e.sav', 'ror_t2s.sav');
diff('ror_t2s.sav', 'ror_t5.sav');
diff('ror_t5.sav', 'ror_t11s.sav');
diff('ror_t11s.sav', 'ror_t11e.sav');
// Athens
diff('athens_t21.sav', 'athens_t22s.sav');
diff('athens_t22s.sav', 'athens_t22mid.sav');
diff('athens_t22mid.sav', 'athens_t22e.sav');
