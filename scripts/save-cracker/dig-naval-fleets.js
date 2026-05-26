// dig-naval-fleets.js
// Decode the naval fleet/ship model:
//  1. group ships into fleets (fleetUuid at i-20 + file-order inheritance)
//  2. resolve each fleet to a type-6 world-object position record (x,y)
//  3. tally ships per fleet, validate counts 1-20
//  4. decode the post-name fields (soldier count, ship-type extras)
//  5. attribute fleets to factions via offset windows against the 23 major records
//
// Research only.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');
const { parseFactionTreasuries, identifyFactionRecordOwners } = require('C:/dev/Provincia/src/saveCrackerExtras.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = ['save_macedon t0.sav', 'save_Seleucids t0.sav'];

// Replicate main.js parseWorldObjectPositions (type-6 records)
function parseWorldObjectPositions(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 8; N++) {
    if (buf.readUInt32LE(N - 12) !== 6) continue;
    if (buf.readUInt32LE(N - 4) !== N - 4) continue;
    const x = buf.readUInt32LE(N);
    if (x < 0 || x > 1100) continue;
    const y = buf.readUInt32LE(N + 4);
    if (y < 0 || y > 800) continue;
    const uuid = buf.readUInt32LE(N - 8);
    if (uuid === 0) continue;
    map.set(uuid, { x, y, offset: N });
  }
  return map;
}

for (const fname of SAVES) {
  const buf = fs.readFileSync(path.join(BASE, fname));
  console.log('\n======================================================================');
  console.log(fname);
  console.log('======================================================================');

  const positions = parseWorldObjectPositions(buf);
  const all = findUnitRecords(buf);
  const naval = all.filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);

  // File-order fleet grouping (mirror main.js synthesis logic)
  let lastFleet = null;
  const fleetGroups = new Map(); // fleetUuid -> [ships]
  for (const u of naval) {
    if (u.fleetUuid && positions.has(u.fleetUuid)) lastFleet = u.fleetUuid;
    const fid = lastFleet;
    u._assignedFleet = fid;
    if (!fid) continue;
    if (!fleetGroups.has(fid)) fleetGroups.set(fid, []);
    fleetGroups.get(fid).push(u);
  }

  // major faction records (for faction attribution by offset window)
  const fr = parseFactionTreasuries(buf);
  // (we won't attribute by faction here yet — first prove the fleet model)

  console.log('positions(type-6): ' + positions.size + ' | naval ships: ' + naval.length +
    ' | distinct fleets: ' + fleetGroups.size + ' | major fac records: ' + fr.length);

  // Per-fleet detail
  const sizes = [];
  let unmatched = 0;
  console.log('\n--- fleets ---');
  for (const [fid, ships] of fleetGroups) {
    const pos = positions.get(fid);
    sizes.push(ships.length);
    const types = {};
    for (const s of ships) types[s.name] = (types[s.name] || 0) + 1;
    const typeStr = Object.entries(types).map(([n, c]) => c + 'x ' + n.replace('naval ', '')).join(', ');
    console.log('  fleet 0x' + fid.toString(16).padStart(8, '0') +
      ' @(' + pos.x + ',' + pos.y + ')' +
      ' ships=' + ships.length +
      ' [' + typeStr + ']' +
      ' firstShip@0x' + ships[0].offset.toString(16));
  }

  // ships that never got a fleet (no inheritance source)
  const orphan = naval.filter(u => !u._assignedFleet);
  unmatched = orphan.length;

  // stats
  sizes.sort((a, b) => a - b);
  const total = sizes.reduce((a, b) => a + b, 0);
  console.log('\n--- summary ---');
  console.log('  ships in fleets: ' + total + ' / ' + naval.length + '  orphan(no fleet): ' + unmatched);
  console.log('  fleet sizes: min=' + sizes[0] + ' max=' + sizes[sizes.length - 1] +
    ' mean=' + (total / sizes.length).toFixed(2));
  const plausible = sizes.every(s => s >= 1 && s <= 20);
  console.log('  all fleet sizes in [1,20]? ' + plausible);
}
