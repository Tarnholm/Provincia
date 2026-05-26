// dig-naval-model.js
// FULL fleet/ship model with the now-confirmed type-4 position record.
//   type-4 record:  N-12=4 | N-8=fleetUuid | N-4=N-4(self) | N=x | N+4=y
// Build: fleets -> [ships], position (x,y), ship counts, ship-type histogram.
// Validate counts 1-20. Attribute fleets to factions by offset window vs the
// 23 major faction records + the player's record region (offset < first major).

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');
const { parseFactionTreasuries, identifyFactionRecordOwners } = require('C:/dev/Provincia/src/saveCrackerExtras.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = ['save_macedon t0.sav', 'save_Seleucids t0.sav',
  'save_Autosave   Carthage   Turn 1 End.sav'];

function parseType4Positions(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 16; N++) {
    if (buf.readUInt32LE(N - 12) !== 4) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N), y = buf.readUInt32LE(N + 4);
    if (x < 0 || x > 1100 || y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0 || uuid === 0xffffffff) continue;
    map.set(uuid, { x, y, off: N });
  }
  return map;
}

for (const fname of SAVES) {
  let buf;
  try { buf = fs.readFileSync(path.join(BASE, fname)); }
  catch (e) { console.log('\n(skip ' + fname + ' — not found)'); continue; }
  console.log('\n======================================================================');
  console.log(fname + '  (' + (buf.length / 1e6).toFixed(1) + ' MB)');
  console.log('======================================================================');

  const t4 = parseType4Positions(buf);
  const all = findUnitRecords(buf);
  const naval = all.filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);

  // group ships into fleets via file-order inheritance against t4 map
  let lastFleet = null;
  const groups = new Map();
  for (const u of naval) {
    if (u.fleetUuid && t4.has(u.fleetUuid)) lastFleet = u.fleetUuid;
    if (!lastFleet) continue;
    if (!groups.has(lastFleet)) groups.set(lastFleet, []);
    groups.get(lastFleet).push(u);
  }
  const orphans = naval.filter(u => {
    // recount: a ship is orphan only if no fleet was ever established before it
    return false;
  });

  console.log('type-4 records: ' + t4.size + ' | naval ships: ' + naval.length + ' | fleets: ' + groups.size);

  const sizes = [];
  console.log('\nfleet                position    ships  composition                  firstShip');
  for (const [fid, ships] of groups) {
    const pos = t4.get(fid);
    sizes.push(ships.length);
    const types = {};
    for (const s of ships) types[s.name.replace('naval ', '')] = (types[s.name.replace('naval ', '')] || 0) + 1;
    const comp = Object.entries(types).map(([n, c]) => c + 'x ' + n).join(', ');
    const soldiers = ships.reduce((a, s) => a + (s.soldiers || 0), 0);
    console.log('0x' + fid.toString(16).padStart(8, '0') +
      '  (' + String(pos.x).padStart(3) + ',' + String(pos.y).padStart(3) + ')   ' +
      String(ships.length).padStart(3) + '   ' + comp.padEnd(28) +
      '  0x' + ships[0].offset.toString(16) + '  crew=' + soldiers);
  }

  sizes.sort((a, b) => a - b);
  const total = sizes.reduce((a, b) => a + b, 0);
  console.log('\nsummary: ships-in-fleets=' + total + '/' + naval.length +
    '  fleet count=' + sizes.length +
    '  sizes[min=' + sizes[0] + ' max=' + sizes[sizes.length - 1] +
    ' mean=' + (total / sizes.length).toFixed(2) + ']' +
    '  plausible(1-20)=' + sizes.every(s => s >= 1 && s <= 20));
}
