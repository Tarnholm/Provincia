// dig-diplo-pairing-reciprocal.js
//
// New lead: uuid-sorted owners show CONSECUTIVE uuid pairs. Test whether each
// relationship is stored as TWO relation objects with adjacent uuids (U, U+1),
// one in faction A's list and the reciprocal in faction B's list. If so, the
// pairing is: uuid U (owner A) <-> uuid U^1 or U+/-1 (owner B), giving the
// target = owner of the partner uuid.
//
// Test variants:
//   (1) partner = U+1 if U even else U-1   (XOR-1 buddy)
//   (2) partner = U-1 / U+1 whichever exists in a DIFFERENT faction
// Validate against descr_strat ground truth for the major-faction pairs.

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

// uuid -> { owner, class_ }
const uuidOwner = new Map();
const ownerRels = new Map(); // owner -> [rel...]
for (let i = 0; i < diplo.length; i++) {
  const name = owners[i].factionName;
  if (!ownerRels.has(name)) ownerRels.set(name, []);
  for (const r of diplo[i].relations) {
    uuidOwner.set(r.uuid, { owner: name, class_: r.class_, attitude: r.attitude });
    ownerRels.get(name).push(r);
  }
}
const uuids = [...uuidOwner.keys()].sort((a,b)=>a-b);

// Count adjacency: how many uuids have U+1 also present?
let adjPresent = 0, adjSameOwner = 0, adjDiffOwner = 0;
for (const u of uuids) {
  if (uuidOwner.has(u + 1)) {
    adjPresent++;
    if (uuidOwner.get(u).owner === uuidOwner.get(u + 1).owner) adjSameOwner++;
    else adjDiffOwner++;
  }
}
console.log('=== Adjacency stats (U and U+1 both present) ===');
console.log('pairs with U+1 present:', adjPresent, ' sameOwner:', adjSameOwner, ' diffOwner:', adjDiffOwner);

// XOR-1 buddy test
let xorPresent = 0, xorSameOwner = 0, xorDiff = 0;
for (const u of uuids) {
  const buddy = u ^ 1;
  if (uuidOwner.has(buddy)) {
    xorPresent++;
    if (uuidOwner.get(u).owner === uuidOwner.get(buddy).owner) xorSameOwner++; else xorDiff++;
  }
}
console.log('XOR-1 buddy present:', xorPresent, ' sameOwner:', xorSameOwner, ' diffOwner:', xorDiff);

// Class consistency: a reciprocal pair should share the SAME class (both war,
// both ally). Check class match for diff-owner adjacent pairs.
console.log('\n=== Class consistency of diff-owner U/U+1 pairs ===');
let classMatch = 0, classMismatch = 0;
const examplePairs = [];
for (const u of uuids) {
  if (uuidOwner.has(u + 1)) {
    const a = uuidOwner.get(u), b = uuidOwner.get(u + 1);
    if (a.owner !== b.owner) {
      if (a.class_ === b.class_) classMatch++; else classMismatch++;
      if (examplePairs.length < 30) examplePairs.push({ u, a, b });
    }
  }
}
console.log('classMatch:', classMatch, ' classMismatch:', classMismatch);
console.log('sample diff-owner pairs:');
for (const e of examplePairs) {
  const cls = c => ['ally','cease','war','?','locked'][c] || c;
  console.log(`  ${e.u}(${e.a.owner},${cls(e.a.class_)}) <-> ${e.u+1}(${e.b.owner},${cls(e.b.class_)})`);
}

// Ground truth among majors
function gtPairs() {
  const txt = fs.readFileSync(DSTRAT, 'latin1');
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*faction_relationships\s+([a-z0-9_]+),?\s+(\d+)\s+([a-z0-9_]+)/i);
    if (!m) continue;
    const from = m[1], value = parseInt(m[2], 10), to = m[3];
    if (to === 'slave') continue;
    out.push({ from, to, kind: value <= 199 ? 'ally' : (value === 200 ? 'neutral' : 'war') });
  }
  return out;
}
const GT = gtPairs();
const majorNames = new Set([...ownerRels.keys()]);
// Build undirected GT set among majors
const gtSet = new Set();
for (const p of GT) {
  if (majorNames.has(p.from) && majorNames.has(p.to)) {
    const key = [p.from, p.to].sort().join('|');
    gtSet.add(key + '#' + p.kind);
  }
}
console.log('\n=== GT undirected pairs among majors ===');
console.log([...gtSet].join('\n'));

// Try to reconstruct pairs via U/U+1 diff-owner and check against GT
console.log('\n=== Reconstructed diff-owner pairs that involve TWO majors ===');
const seen = new Set();
for (const u of uuids) {
  if (uuidOwner.has(u + 1)) {
    const a = uuidOwner.get(u), b = uuidOwner.get(u + 1);
    if (a.owner !== b.owner) {
      const key = [a.owner, b.owner].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const cls = ['ally','cease','war','?','locked'][a.class_] || a.class_;
      const inGT = [...gtSet].some(g => g.startsWith(key + '#'));
      console.log(`  ${a.owner} <-> ${b.owner} (${cls}) ${inGT ? 'IN-GT' : ''}`);
    }
  }
}
