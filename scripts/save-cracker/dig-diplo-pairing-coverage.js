// dig-diplo-pairing-coverage.js
//
// Reconcile: registry says FACTION_ECONOMICS=36. We find 23 (+44=6) cleanly.
// Find ALL 36 by scanning the FACTION_ECONOMICS section as a contiguous array
// from the first record, OR by relaxing the signature. Then determine if the
// MISSING partners (targets of the 316 relations) have records at all.
//
// Decisive question for crackability: a relation U owned by faction A targets
// faction B. If B has its OWN record with a relation that we can tie back to A
// (even without a shared uuid), pairing is possible. We test: do the relation
// COUNTS form a consistent directed graph that matches descr_strat?

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav';
const buf = fs.readFileSync(SAVE);
const DIPLO_MARKER = 0x39240005;

// Find the 23 clean +44=6 records to anchor the FACTION_ECONOMICS section.
const clean = [];
for (let i = 0; i + 96 < buf.length; i++) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 6) continue;
  const regions = buf.readUInt32LE(i + 48);
  if (regions > 200) continue;
  if (i + 244 + 4 * regions + 4 > buf.length) continue;
  if (buf.readUInt32LE(i + 244 + 4 * regions) !== DIPLO_MARKER) continue;
  clean.push(i);
}
console.log('clean +44=6 records:', clean.length, 'range 0x' + clean[0].toString(16) + ' .. 0x' + clean[clean.length-1].toString(16));

// Walk forward from the first record, parsing each record fully to find its
// end (after the diplo block) and discover the NEXT record regardless of +44.
// A record's structure: header(52) + regions(4N) + mid + faction_id/ai +
// diplo(8 + 16*count) + ... we don't know the full trailer, so instead just
// scan between consecutive clean records for ANY diplo marker to count all
// faction diplomacy blocks in the section.
console.log('\n=== Diplo markers in the FACTION_ECONOMICS zone ===');
const zoneStart = clean[0];
const zoneEnd = clean[clean.length - 1] + 0x20000; // a bit past last
let markerCount = 0;
const markers = [];
for (let p = zoneStart; p < Math.min(zoneEnd, buf.length - 8); p++) {
  if (buf.readUInt32LE(p) === DIPLO_MARKER) {
    const count = buf.readUInt32LE(p + 4);
    if (count <= 300) { markers.push({ at: p, count }); markerCount++; p += 8 + count * 16 - 1; }
  }
}
console.log('diplo markers found in zone:', markerCount);
let totalRel = 0;
for (const m of markers) totalRel += m.count;
console.log('total relations in zone:', totalRel);

// Collect all uuids across ALL markers in the zone (this is the FULL diplomacy
// dataset, not just the 23). Re-test uniqueness.
const uuidCount = new Map();
const classByUuid = new Map();
for (const m of markers) {
  for (let k = 0; k < m.count; k++) {
    const o = m.at + 8 + k * 16;
    const u = buf.readUInt32LE(o);
    uuidCount.set(u, (uuidCount.get(u) || 0) + 1);
    if (!classByUuid.has(u)) classByUuid.set(u, []);
    classByUuid.get(u).push(buf.readUInt32LE(o + 4));
  }
}
const dups = [...uuidCount.entries()].filter(([u, c]) => c > 1);
console.log('distinct uuids:', uuidCount.size, ' duplicated uuids (appear in >1 relation):', dups.length);
if (dups.length) {
  console.log('  sample dups:', dups.slice(0, 15).map(([u,c]) => `${u}x${c}`).join(', '));
  // For duplicated uuids, do the two copies have the SAME class? (reciprocal sanity)
  let agree=0, disagree=0;
  for (const [u, c] of dups) {
    const cls = classByUuid.get(u);
    if (cls.every(x => x === cls[0])) agree++; else disagree++;
  }
  console.log('  dup class agree:', agree, ' disagree:', disagree);
}

// uuid range + density
const us = [...uuidCount.keys()].sort((a,b)=>a-b);
console.log('uuid range:', us[0], '..', us[us.length-1], ' count:', us.length);
let consec = 0;
for (let i = 1; i < us.length; i++) if (us[i] === us[i-1] + 1) consec++;
console.log('consecutive uuid fraction:', (consec / us.length * 100).toFixed(1) + '%');
