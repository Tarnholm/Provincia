// dig-tax-ris-explore.js
// Understand the RIS settlement record structure: how many markers, how many
// distinct names, whether names repeat, and hex-dump around a known settlement.

const fs = require('fs');
const path = require('path');
const { findAllSettlementMarkers } = require('../../src/buildingParser');

const ROME = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const FILE = process.argv[2] || 'save_macedon t0.sav';
const buf = fs.readFileSync(path.join(ROME, FILE));
const markers = findAllSettlementMarkers(buf);

const byName = {};
for (const m of markers) (byName[m.name] = byName[m.name] || []).push(m.offset);
const names = Object.keys(byName);
console.log('FILE %s  size=%d', FILE, buf.length);
console.log('total markers=%d  distinct names=%d', markers.length, names.length);
const multi = names.filter(n => byName[n].length > 1);
console.log('names with >1 marker: %d', multi.length);
console.log('sample multi:', multi.slice(0, 12).map(n => n + 'x' + byName[n].length).join('  '));

for (const n of ['Pella', 'Thessalonica', 'Larissa', 'Sparta', 'Athens', 'Corinth', 'Byzantium', 'Rome']) {
  if (byName[n]) console.log('  %s: %s', n, byName[n].map(o => '0x' + o.toString(16)).join('  '));
}

// Hex dump around the first marker of a chosen settlement.
function hexDump(off, lo, hi) {
  console.log('\n=== hex dump around 0x%s  (dx %d..%d) ===', off.toString(16), lo, hi);
  for (let base = lo; base < hi; base += 16) {
    const row = [];
    const asc = [];
    for (let k = 0; k < 16; k++) {
      const o = off + base + k;
      if (o < 0 || o >= buf.length) { row.push('  '); asc.push(' '); continue; }
      row.push(buf[o].toString(16).padStart(2, '0'));
      asc.push(buf[o] >= 0x20 && buf[o] <= 0x7e ? String.fromCharCode(buf[o]) : '.');
    }
    console.log('dx%s  %s  %s', String(base).padStart(5), row.join(' '), asc.join(''));
  }
}

const targetName = process.argv[3] || (byName['Pella'] ? 'Pella' : names[0]);
const targetOff = byName[targetName][0];
console.log('\nDumping %s @ 0x%s', targetName, targetOff.toString(16));
hexDump(targetOff, -160, 64);
