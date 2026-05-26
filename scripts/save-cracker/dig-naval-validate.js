// dig-naval-validate.js
// Cross-validate the save's fleet model against descr_strat (armies_large.json).
// descr_strat admirals carry {faction, x, y, units[]}. We match save fleets to
// them by (x,y) tile. Reports:
//   - per-fleet faction (from descr_strat coord match)
//   - ship type + count agreement (save vs descr_strat)
//   - naval power per faction (fleets / ships) computed from the SAVE alone
//     once each fleet is attributed by coord.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const SAVES = ['save_macedon t0.sav', 'save_Seleucids t0.sav'];
const armies = require('C:/dev/Provincia/public/armies_large.json');

// descr_strat naval admirals by "x,y"
const dsByCoord = new Map();
for (const v of Object.values(armies)) {
  const units = Array.isArray(v.units) ? v.units : [];
  const navs = units.filter(u => /naval/i.test(u.name || ''));
  if (!navs.length) continue;
  dsByCoord.set(v.x + ',' + v.y, {
    faction: v.faction, name: v.name, x: v.x, y: v.y,
    ships: navs.map(u => u.name),
  });
}
console.log('descr_strat naval admirals: ' + dsByCoord.size + '\n');

function parseType4(buf) {
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
  const buf = fs.readFileSync(path.join(BASE, fname));
  console.log('======================================================================');
  console.log(fname);
  console.log('======================================================================');

  const t4 = parseType4(buf);
  const naval = findUnitRecords(buf).filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);

  let lastFleet = null; const groups = new Map();
  for (const u of naval) {
    if (u.fleetUuid && t4.has(u.fleetUuid)) lastFleet = u.fleetUuid;
    if (!lastFleet) continue;
    if (!groups.has(lastFleet)) groups.set(lastFleet, []);
    groups.get(lastFleet).push(u);
  }

  let matched = 0, typeMatch = 0, countMatch = 0;
  const navalPower = {}; // faction -> {fleets, ships}
  const unmatchedCoords = [];
  for (const [fid, ships] of groups) {
    const pos = t4.get(fid);
    const ds = dsByCoord.get(pos.x + ',' + pos.y);
    if (!ds) { unmatchedCoords.push(pos.x + ',' + pos.y); continue; }
    matched++;
    // type agreement
    const saveTypes = ships.map(s => s.name).sort();
    const dsTypes = ds.ships.slice().sort();
    if (JSON.stringify(saveTypes) === JSON.stringify(dsTypes)) typeMatch++;
    if (ships.length === ds.ships.length) countMatch++;
    if (!navalPower[ds.faction]) navalPower[ds.faction] = { fleets: 0, ships: 0 };
    navalPower[ds.faction].fleets++;
    navalPower[ds.faction].ships += ships.length;
  }

  console.log('fleets=' + groups.size +
    ' | coord-matched to descr_strat=' + matched + '/' + groups.size +
    ' | shipType agree=' + typeMatch + '/' + matched +
    ' | shipCount agree=' + countMatch + '/' + matched);
  if (unmatchedCoords.length) console.log('  unmatched fleet coords: ' + unmatchedCoords.join('  '));

  console.log('\nNAVAL POWER per faction (from save fleets, coord-attributed):');
  for (const [fac, p] of Object.entries(navalPower).sort((a, b) => b[1].ships - a[1].ships)) {
    console.log('   ' + fac.padEnd(20) + ' fleets=' + p.fleets + '  ships=' + p.ships);
  }
  console.log('');
}
