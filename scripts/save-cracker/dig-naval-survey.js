// dig-naval-survey.js
// Survey naval unit records across the RIS ground-truth saves.
// Goals:
//  - count naval-prefix units per save and per faction-region
//  - dump bytes around the first few to study fleet header / ship-type encoding
//  - cross-check against type-4 position records (fleetUuid at i-20)
//
// Research only; no app code modified.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = ['save_macedon t0.sav', 'save_Seleucids t0.sav'];

function hexrow(buf, off, n) {
  const hex = Array.from(buf.slice(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(buf.slice(off, off + n)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  return '0x' + off.toString(16) + ': ' + hex + '  |' + asc + '|';
}

for (const fname of SAVES) {
  const buf = fs.readFileSync(path.join(BASE, fname));
  console.log('\n======================================================================');
  console.log(fname + '  (' + buf.length + ' bytes)');
  console.log('======================================================================');

  const all = findUnitRecords(buf);
  const naval = all.filter(u => /^naval\b/i.test(u.name));
  console.log('total unit records: ' + all.length + ' | naval-prefix: ' + naval.length);

  // distinct ship type names
  const byName = {};
  for (const u of naval) byName[u.name] = (byName[u.name] || 0) + 1;
  console.log('naval type histogram:');
  for (const [n, c] of Object.entries(byName).sort((a, b) => b[1] - a[1])) {
    console.log('   ' + c.toString().padStart(4) + '  ' + n);
  }

  // region histogram (should all be "the sea")
  const byRegion = {};
  for (const u of naval) byRegion[u.region] = (byRegion[u.region] || 0) + 1;
  console.log('naval region histogram: ' + JSON.stringify(byRegion));

  // fleetUuid stats
  const withFleet = naval.filter(u => u.fleetUuid);
  console.log('naval with non-null fleetUuid: ' + withFleet.length + ' / ' + naval.length);

  // dump bytes around first 3 naval records (include 40 bytes BEFORE name for fleet header)
  console.log('\n--- byte dumps around first 3 naval records ---');
  for (const u of naval.slice(0, 3)) {
    console.log('\n  naval "' + u.name + '" @0x' + u.offset.toString(16) +
      ' fleetUuid=' + (u.fleetUuid ? u.fleetUuid.toString(16) : 'null') +
      ' soldiers=' + u.soldiers + '/' + u.maxSoldiers +
      ' passengers=' + JSON.stringify(u.passengerUuids));
    for (let off = u.offset - 64; off < u.offset + 96; off += 16) {
      if (off < 0) continue;
      console.log('   ' + hexrow(buf, off, 16));
    }
  }
}
