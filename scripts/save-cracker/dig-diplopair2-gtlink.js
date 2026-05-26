// dig-diplopair2-gtlink.js
//
// For every GT pair (A,B) where BOTH have zones, search for ANY linking
// invariant between A's relations and B's relations. We KNOW A and B are
// related with kind K (war/ally). So:
//   - A's zone must contain >=1 relation of class matching K (class 2=war, 0=ally).
//   - B's zone must too.
// If the relationship is stored bidirectionally, exactly one A-entry and one
// B-entry are "the A<->B relation". We try to identify which by testing every
// candidate (a-uuid, b-uuid) pair (both of the right class) for an invariant:
//   delta = a-uuid - b-uuid; collect ALL deltas across ALL GT pairs and see if
//   a single delta (or small set) dominates. If a constant delta links A->B
//   reliably, THAT is the crack.
// Also test: same attitude? same uuid? a-uuid==b-uuid (shared)? consecutive?

const fs = require('fs');
const L = require('./dig-diplopair2-lib.js');
const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav';
const buf = fs.readFileSync(SAVE);
const fo = L.parseFactionOrder();
const zones = L.dedupZones(L.parseZones(buf, fo));
const zmap = new Map(zones.map(z => [z.name, z]));
const gt = L.parseGT();

const classForKind = { war: 2, ally: 0 };

// For each GT pair both present, list candidate matches and deltas.
const allDeltas = [];
let pairsBoth = 0, pairsHaveClassBoth = 0;
const sample = [];
for (const [key, kind] of gt) {
  const [a, b] = key.split('|');
  const za = zmap.get(a), zb = zmap.get(b);
  if (!za || !zb) continue;
  pairsBoth++;
  const want = classForKind[kind];
  // candidates of the right class on each side. Note: war can also be stored
  // as class 1 (ceasefire) or 4 (locked) sometimes; ally maybe class 4 too.
  // Be permissive: war -> {2,1}, ally -> {0,4}.
  const wantSet = kind === 'war' ? new Set([2, 1]) : new Set([0, 4]);
  const aCands = za.relations.filter(r => wantSet.has(r.class_));
  const bCands = zb.relations.filter(r => wantSet.has(r.class_));
  if (aCands.length === 0 || bCands.length === 0) continue;
  pairsHaveClassBoth++;
  // collect all cross deltas
  const deltas = [];
  for (const ra of aCands) for (const rb of bCands) deltas.push(ra.uuid - rb.uuid);
  for (const d of deltas) allDeltas.push(d);
  if (sample.length < 25) sample.push({ key, kind, a: aCands.map(r => r.uuid), b: bCands.map(r => r.uuid) });
}
console.log('GT pairs both-present:', pairsBoth, ' with right-class on both sides:', pairsHaveClassBoth);

// Delta histogram — which deltas occur most? If a constant delta links pairs,
// it will spike. But since each pair has many candidate combos, we expect
// noise. The KEY signal would be: a delta that appears >= pairsHaveClassBoth
// times (once per pair) i.e. present in (nearly) every pair.
const deltaCount = new Map();
for (const d of allDeltas) deltaCount.set(d, (deltaCount.get(d) || 0) + 1);
const topDeltas = [...deltaCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log('\nTop cross-deltas (a-uuid - b-uuid) over GT pairs:');
for (const [d, c] of topDeltas) console.log(`  delta=${d}: ${c} occurrences`);

// Per-pair: is there a delta in {+/-1, +/-2, 0, XOR1} for ANY candidate combo?
let withSmall = 0, withZero = 0, withXor = 0;
for (const [key, kind] of gt) {
  const [a, b] = key.split('|');
  const za = zmap.get(a), zb = zmap.get(b); if (!za || !zb) continue;
  const wantSet = kind === 'war' ? new Set([2, 1]) : new Set([0, 4]);
  const aC = za.relations.filter(r => wantSet.has(r.class_)).map(r => r.uuid);
  const bC = zb.relations.filter(r => wantSet.has(r.class_)).map(r => r.uuid);
  let small = false, zero = false, xor = false;
  for (const x of aC) for (const y of bC) {
    if (x === y) zero = true;
    if (Math.abs(x - y) <= 2) small = true;
    if ((x ^ y) === 1) xor = true;
  }
  if (small) withSmall++; if (zero) withZero++; if (xor) withXor++;
}
console.log('\nPer-GT-pair connectivity (any candidate combo):');
console.log('  shared uuid (a==b):', withZero, '/', pairsHaveClassBoth);
console.log('  |delta|<=2       :', withSmall, '/', pairsHaveClassBoth);
console.log('  XOR1             :', withXor, '/', pairsHaveClassBoth);

console.log('\nSample GT pairs (right-class uuids each side):');
for (const s of sample) console.log(`  ${s.key} [${s.kind}]  A=[${s.a.join(',')}]  B=[${s.b.join(',')}]`);
