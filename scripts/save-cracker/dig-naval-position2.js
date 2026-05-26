// dig-naval-position2.js
// Trace fleet position via the admiral's character graph.
// hit#1 (admiral char record): [uuidA @p-8][uuidB @p-4][fleetUuid @p][5][30]...
//   -> uuidA, uuidB might be own_uuid / secondary_uuid; their type-6 pos record
//      would carry x,y.
// hit#2 (graph node): [self][self+4][4][fleetUuid][...][399]  -> check framing.
// Plan: for the first 5 fleets, extract uuidA/uuidB at admiral hit, then look
//   them up in the type-6 position map. Report which yields a sea-ish coord.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const fname = 'save_macedon t0.sav';
const buf = fs.readFileSync(path.join(BASE, fname));

function hexrow(off, n) {
  const hex = Array.from(buf.slice(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(buf.slice(off, off + n)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  return '0x' + off.toString(16) + ': ' + hex + '  |' + asc + '|';
}

// type-6 position map
const posMap = new Map();
for (let N = 24; N < buf.length - 16; N++) {
  if (buf.readUInt32LE(N - 12) !== 6) continue;
  if (buf.readUInt32LE(N - 4) !== N - 4) continue;
  const x = buf.readUInt32LE(N), y = buf.readUInt32LE(N + 4);
  if (x < 0 || x > 1100 || y < 0 || y > 800) continue;
  const uuid = buf.readUInt32LE(N - 8);
  if (uuid === 0) continue;
  posMap.set(uuid, { x, y, off: N });
}
console.log('type-6 positions: ' + posMap.size);

const all = findUnitRecords(buf);
const naval = all.filter(u => /^naval\b/i.test(u.name) && u.fleetUuid).sort((a, b) => a.offset - b.offset);

// distinct first-ship fleets
const seen = new Set();
const fleets = [];
for (const u of naval) { if (!seen.has(u.fleetUuid)) { seen.add(u.fleetUuid); fleets.push(u); } }
console.log('distinct fleetUuids: ' + fleets.length + '\n');

for (const u of fleets.slice(0, 6)) {
  const fid = u.fleetUuid;
  const target = Buffer.alloc(4); target.writeUInt32LE(fid);
  // first occurrence = admiral char record. Extract uuidA=p-8, uuidB=p-4.
  const adm = buf.indexOf(target, 0);
  const uuidA = adm >= 8 ? buf.readUInt32LE(adm - 8) : 0;
  const uuidB = adm >= 4 ? buf.readUInt32LE(adm - 4) : 0;
  const posF = posMap.get(fid);
  const posA = posMap.get(uuidA);
  const posB = posMap.get(uuidB);
  console.log('fleet 0x' + fid.toString(16) +
    '  posByFleet=' + (posF ? `(${posF.x},${posF.y})` : 'none') +
    '  uuidA=0x' + uuidA.toString(16) + (posA ? ` ->(${posA.x},${posA.y})` : ' ->none') +
    '  uuidB=0x' + uuidB.toString(16) + (posB ? ` ->(${posB.x},${posB.y})` : ' ->none'));
}

// Now: maybe the fleet has its OWN type-6-like record but with marker != 6.
// Let's scan ALL self-pointer records (u32(N-4)==N-4) regardless of marker,
// and see which marker value the fleetUuids use.
console.log('\n-- marker histogram for self-ptr records whose uuid is a fleetUuid --');
const fleetSet = new Set(fleets.map(f => f.fleetUuid));
const markerHist = {};
for (let N = 24; N < buf.length - 16; N++) {
  if (buf.readUInt32LE(N - 4) !== N - 4) continue;
  const uuid = buf.readUInt32LE(N - 8);
  if (!fleetSet.has(uuid)) continue;
  const marker = buf.readUInt32LE(N - 12);
  const x = buf.readUInt32LE(N), y = buf.readUInt32LE(N + 4);
  const key = 'marker=' + marker;
  markerHist[key] = (markerHist[key] || 0) + 1;
  console.log('   fleetUuid 0x' + uuid.toString(16) + ' self-ptr@0x' + N.toString(16) +
    ' marker=' + marker + ' x=' + x + ' y=' + y);
}
console.log('   histogram: ' + JSON.stringify(markerHist));
