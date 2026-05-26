// dig-diplopair2-storage.js
//
// Determine the STORAGE MODEL of relationships. For each GT pair (A,B) both
// present, classify:
//   - BOTH sides have a compatible-class entry  (bidirectional storage)
//   - ONLY A has it / ONLY B has it             (single-sided storage)
//   - NEITHER                                   (relationship not represented)
// This tells us whether partner recovery is even structurally possible via
// symmetry, and bounds how complete any solution could be.
//
// Also: total entries 806. If bidirectional, #relationships ~= 403. If single,
// ~= 806. Compare to plausible relationship counts.

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const buf = fs.readFileSync(SAVE);
const fo = L.parseFactionOrder();
const zones = L.dedupZones(L.parseZones(buf, fo));
const zmap = new Map(zones.map(z => [z.name, z]));
const gt = L.parseGT();

const wantSetFor = kind => kind === 'war' ? new Set([2, 1]) : new Set([0, 4]);

let both = 0, onlyA = 0, onlyB = 0, neither = 0, missingZone = 0;
const neitherList = [], onlyList = [];
for (const [key, kind] of gt) {
  const [a, b] = key.split('|');
  const za = zmap.get(a), zb = zmap.get(b);
  if (!za || !zb) { missingZone++; continue; }
  const ws = wantSetFor(kind);
  const aHas = za.relations.some(r => ws.has(r.class_));
  const bHas = zb.relations.some(r => ws.has(r.class_));
  if (aHas && bHas) both++;
  else if (aHas) { onlyA++; if (onlyList.length < 20) onlyList.push(`${key}[${kind}] onlyA(${a})`); }
  else if (bHas) { onlyB++; if (onlyList.length < 20) onlyList.push(`${key}[${kind}] onlyB(${b})`); }
  else { neither++; if (neitherList.length < 20) neitherList.push(`${key}[${kind}]`); }
}
console.log('=== GT-pair storage classification (compatible-class presence) ===');
console.log('both sides have a compatible entry:', both);
console.log('only one side has it:', onlyA + onlyB);
console.log('neither side has it:', neither);
console.log('a GT faction has no zone:', missingZone);
console.log('\nNote: "both" only means each side has SOME war/ally entry, not that it');
console.log('is THIS partner. With dense lists, "both" is near-automatic and not proof.');

// The discriminating test: count how often a faction has MORE compatible
// entries than its GT degree. If lists carry stances toward many partners,
// per-faction war-entry count should ~match GT war-degree IF complete.
const gtDeg = {};
for (const [key, kind] of gt) { const [a, b] = key.split('|'); for (const f of [a, b]) { gtDeg[f] = gtDeg[f] || { war: 0, ally: 0 }; gtDeg[f][kind === 'war' ? 'war' : 'ally']++; } }

console.log('\n=== Per-faction: save war/ally entry count vs GT degree (factions in GT) ===');
console.log('faction            | saveWar saveAlly | gtWar gtAlly | warMatch allyMatch');
let warExact = 0, allyExact = 0, n = 0;
const rows = [];
for (const f of Object.keys(gtDeg).sort()) {
  const z = zmap.get(f); if (!z) continue;
  const sv = { war: 0, ally: 0 };
  for (const r of z.relations) { if (r.class_ === 2 || r.class_ === 1) sv.war++; else if (r.class_ === 0 || r.class_ === 4) sv.ally++; }
  const g = gtDeg[f];
  n++;
  const wm = sv.war === g.war, am = sv.ally === g.ally;
  if (wm) warExact++; if (am) allyExact++;
  rows.push(`${f.padEnd(18)} | ${String(sv.war).padStart(6)} ${String(sv.ally).padStart(7)} | ${String(g.war).padStart(5)} ${String(g.ally).padStart(6)} | ${wm ? 'Y' : 'n'}        ${am ? 'Y' : 'n'}`);
}
for (const r of rows) console.log(r);
console.log(`\nwar-degree exact match: ${warExact}/${n}   ally-degree exact match: ${allyExact}/${n}`);
console.log('(If save lists were the COMPLETE & ONLY copy of GT relations, these');
console.log(' would be ~100%. Mismatch => save lists include MANY non-GT (dynamic)');
console.log(' relations and/or omit GT ones — list is not a clean per-faction GT mirror.)');

console.log('\nSample "neither" GT pairs:', neitherList.join('  '));
console.log('Sample "only-one-side" GT pairs:', onlyList.join('  '));
