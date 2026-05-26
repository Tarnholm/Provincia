// dig-diplo-pairing-order.js
//
// Hypothesis (d): per-faction relation LISTS are ordered by target faction.
// Hypothesis (c): tag/attitude high bytes encode a target index.
//
// We have ground-truth among the 23 major factions (8 ally decls). Test if
// the within-list ORDER lines up with target faction index in some order
// (descr_sm_factions order, or descr_strat declaration order).
//
// Also: relationUuid is a global creation counter. At T0 all relations are
// created during init. If creation is ordered, we may reconstruct pairs by
// matching the GLOBAL uuid sort against descr_strat's declaration order.

const fs = require('fs');
const X = require('../../src/saveCrackerExtras.js');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const DSTRAT = 'C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt';
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

// owner name -> record index
const nameToRec = new Map();
owners.forEach((o, i) => { if (o.factionName) nameToRec.set(o.factionName, i); });
const majorNames = new Set([...nameToRec.keys()]);

// ground truth pairs (directed) among ANY factions
function gtPairs() {
  const txt = fs.readFileSync(DSTRAT, 'latin1');
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1], value = parseInt(m[2], 10), to = m[3];
    if (to === 'slave') continue;
    out.push({ from, to, value, kind: value <= 199 ? 'ally' : (value === 200 ? 'neutral' : 'war') });
  }
  return out;
}
const GT = gtPairs();

// === Test (c): does attitude / tag vary in a way that maps to a target? ===
console.log('=== (c) Field variability check ===');
const tagVals = new Set(), attVals = new Set();
for (const d of diplo) for (const r of d.relations) { tagVals.add(r.tag); attVals.add(r.attitude); }
console.log('distinct tags:', [...tagVals]);
console.log('distinct attitudes:', [...attVals]);
console.log('-> tag is constant (0x10101) so it cannot encode a target. attitude only 0..4.');

// === Test (d): per-faction list ordering ===
// For the small major factions we know exactly which other majors they relate
// to from GT. List acarnania/achaea/aetolia/athens/ptolemaic relations sorted
// by their position in the list and by uuid, then see if order matches a
// faction ordering.
console.log('\n=== (d) Per-faction relation list (position + uuid + class) ===');
for (const name of ['acarnania', 'aetolia', 'achaea', 'athens', 'ptolemaic', 'seleucid', 'romans_julii']) {
  const ri = nameToRec.get(name);
  if (ri == null) continue;
  const rels = diplo[ri].relations;
  // Among GT, which majors does `name` relate to?
  const gtForName = GT.filter(p => p.from === name);
  const gtMajorTargets = gtForName.filter(p => majorNames.has(p.to)).map(p => `${p.to}(${p.kind})`);
  console.log(`\n${name}: ${rels.length} relations. GT major targets: [${gtMajorTargets.join(', ')}]`);
  rels.forEach((r, k) => {
    const cls = ['ally','cease','war','?','locked'][r.class_] || r.class_;
    console.log(`  pos ${String(k).padStart(2)}: uuid=${String(r.uuid).padStart(4)} class=${cls} att=${r.attitude}`);
  });
}

// === Counting test: does #relations per faction == #GT decls (directed) for that faction? ===
console.log('\n=== (d) relation count vs GT directed-decl count ===');
console.log('faction'.padEnd(18), 'saveRels', 'gtFrom(non-slave)', 'gtFrom+slave?');
for (const [name, ri] of nameToRec) {
  const rels = diplo[ri].relations.length;
  const gtFrom = GT.filter(p => p.from === name).length;
  console.log(name.padEnd(18), String(rels).padStart(8), String(gtFrom).padStart(16));
}

// === Global uuid-sorted creation-order test ===
// Collect ALL relations across all factions, sorted by uuid. If creation order
// follows descr_strat declaration order, consecutive uuids should belong to the
// same `from` faction in blocks. Print the owner sequence by uuid.
console.log('\n=== Global uuid-sorted owner sequence (first 60) ===');
const all = [];
for (let i = 0; i < diplo.length; i++) for (const r of diplo[i].relations) all.push({ uuid: r.uuid, owner: owners[i].factionName, class_: r.class_ });
all.sort((a,b)=>a.uuid-b.uuid);
let line = '';
for (let i = 0; i < Math.min(all.length, 60); i++) {
  line += `${all[i].uuid}:${all[i].owner}  `;
  if ((i+1) % 4 === 0) { console.log('  ' + line); line=''; }
}
if (line) console.log('  ' + line);
