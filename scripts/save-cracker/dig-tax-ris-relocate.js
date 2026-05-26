// dig-tax-ris-relocate.js
//
// The Alexander offsets (level -571, PO -435, income -127, tax -562 from the
// pstr16 prefix) DO NOT line up in the RIS Rome-campaign saves: there
// level/PO/income all read 0 while only pop (-35) is correct. So the RIS
// stats block has a different size/layout. Re-derive the RIS offsets.
//
// Approach: pick well-known settlements in a LATER-turn RIS save (income
// populated). pop is known (dx=-35 from pstr16 prefix == marker.offset-34).
// Scan dx from -700..-1 (relative to marker.offset) for u32 fields that match
// each settlement's KNOWN ground truth, and for a 0..4 enum (tax candidate).
//
// Ground truth (from in-game / memory): we don't have exact income for RIS
// here, so instead we find fields by their cross-settlement SHAPE:
//   * pop: re-confirm at -34 (marker)
//   * a u32 that is 0..6 and constant-ish across all  => level
//   * a u32 that is 0..100                            => PO
//   * a u32 in the hundreds..tens-of-thousands, > pop/4 and != pop => income
//   * a u8/u32 that is 0..4                           => tax candidate
//
// Read-only.

const fs = require('fs');
const path = require('path');
const { findAllSettlementMarkers } = require('../../src/buildingParser');

const ROME = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const FILE = process.argv[2] || 'save_Autosave   Republic of Rome   Turn 4 End.sav';
const buf = fs.readFileSync(path.join(ROME, FILE));
console.log('FILE: %s  size=%d', FILE, buf.length);

const markers = findAllSettlementMarkers(buf);
// Pick a handful of distinct, real settlements (player Rome capital region).
const TARGETS = ['Rome', 'Arretium', 'Capua', 'Tarentum', 'Croton', 'Neapolis', 'Patavium', 'Mediolanium'];
const recs = [];
for (const name of TARGETS) {
  const m = markers.find(mm => mm.name === name);
  if (m) recs.push({ name, off: m.offset });
}
console.log('records:', recs.map(r => r.name + '@0x' + r.off.toString(16)).join('  '));

// pop confirm
console.log('\npop @ marker-34:');
for (const r of recs) console.log('  %s = %d', r.name, buf.readUInt32LE(r.off - 34));

// Build per-dx column of u32 values across all target settlements.
const perDx = {};
for (const r of recs) {
  for (let dx = -800; dx <= -1; dx++) {
    const o = r.off + dx;
    if (o < 0 || o + 4 > buf.length) continue;
    (perDx[dx] = perDx[dx] || {})[r.name] = buf.readUInt32LE(o);
  }
}
function scan(label, pred, opts = {}) {
  console.log('\n=== %s ===', label);
  const hits = [];
  for (const dx of Object.keys(perDx).map(Number).sort((a, b) => a - b)) {
    const col = perDx[dx];
    const names = Object.keys(col);
    if (names.length < recs.length) continue;
    if (!names.every(n => pred(col[n], col))) continue;
    if (opts.distinctMax) {
      const distinct = new Set(names.map(n => col[n]));
      if (distinct.size > opts.distinctMax) continue;
    }
    if (opts.notAllZero) {
      if (names.every(n => col[n] === 0)) continue;
    }
    hits.push(dx);
    console.log('  dx=%d  %s', dx, names.map(n => n + '=' + col[n]).join('  '));
  }
  if (!hits.length) console.log('  (none)');
  return hits;
}

scan('LEVEL (u32 0..6, not all zero)', v => v >= 0 && v <= 6, { notAllZero: true });
scan('PO (u32 0..100, not all zero)', v => v >= 0 && v <= 100, { notAllZero: true });
scan('INCOME (u32 100..60000)', v => v >= 100 && v <= 60000);
scan('TAX enum (u32 0..4, <=5 distinct)', v => v >= 0 && v <= 4, { distinctMax: 5 });

// Also scan u8 columns for a 0..4 enum (tax may be a single byte).
const perDxB = {};
for (const r of recs) {
  for (let dx = -800; dx <= -1; dx++) {
    const o = r.off + dx;
    if (o < 0 || o >= buf.length) continue;
    (perDxB[dx] = perDxB[dx] || {})[r.name] = buf[o];
  }
}
console.log('\n=== TAX u8 enum (0..4, present in all, <=5 distinct, not all zero) ===');
for (const dx of Object.keys(perDxB).map(Number).sort((a, b) => a - b)) {
  const col = perDxB[dx];
  const names = Object.keys(col);
  if (names.length < recs.length) continue;
  if (!names.every(n => col[n] >= 0 && col[n] <= 4)) continue;
  if (names.every(n => col[n] === 0)) continue;
  const distinct = new Set(names.map(n => col[n]));
  if (distinct.size > 5) continue;
  console.log('  dx=%d  %s', dx, names.map(n => n + '=' + col[n]).join('  '));
}
