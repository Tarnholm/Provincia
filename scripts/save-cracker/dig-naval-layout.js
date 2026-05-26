// dig-naval-layout.js
// Pin the exact byte layout of (a) the ship unit record and (b) the type-4
// fleet record, with the secUuid linkage between them.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_macedon t0.sav'));

function parseType4(buf) {
  const map = new Map();
  for (let N = 24; N < buf.length - 40; N++) {
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

const t4 = parseType4(buf);
const naval = findUnitRecords(buf).filter(u => /^naval\b/i.test(u.name) && u.fleetUuid && t4.has(u.fleetUuid))
  .sort((a, b) => a.offset - b.offset);

const u = naval[0]; // first single-ship fleet
const fid = u.fleetUuid;
const N = t4.get(fid).off;

console.log('Ship "' + u.name + '" @0x' + u.offset.toString(16) + '  fleetUuid=0x' + fid.toString(16));
console.log('\n-- SHIP RECORD field decode --');
// record begins a bit before the u16 name-length. unitParser reads name len at i.
const i = u.offset;
console.log('  i+0  u16 nameLen          = ' + buf.readUInt16LE(i));
const nameLen = buf.readUInt16LE(i);
let q = i + 2 + nameLen; // after name+\0
console.log('  name                       = "' + buf.slice(i + 2, i + 2 + nameLen - 1).toString('ascii') + '"');
console.log('  after-name @0x' + q.toString(16));
console.log('  +0  u8                     = 0x' + buf[q].toString(16) + '  (ship-class discriminator: 4/5/7 seen)');
console.log('  +1  u32 shipHashA          = 0x' + buf.readUInt32LE(q + 1).toString(16));
console.log('  +5  u32 secUuid(=fleet+32) = 0x' + buf.readUInt32LE(q + 5).toString(16));
// region marker + soldier counts handled by parser; show the 0x12c (300) field
// From dump: after name "...05 17 cf 4a bc f6 0e a2 | 0f 00 00 00 | 00 2c 01 00 00 ..."
console.log('  +9  u32                    = 0x' + buf.readUInt32LE(q + 9).toString(16) + '  (=' + buf.readUInt32LE(q + 9) + ')');
console.log('  +14 u32 = 0x012c (300)?    = 0x' + buf.readUInt32LE(q + 14).toString(16) + '  (=' + buf.readUInt32LE(q + 14) + ' likely unit category/cost)');

console.log('\n-- TYPE-4 FLEET RECORD field decode @0x' + N.toString(16) + ' --');
console.log('  N-12 u32 marker            = ' + buf.readUInt32LE(N - 12) + '   (==4: FLEET/world-object class)');
console.log('  N-8  u32 fleetUuid         = 0x' + buf.readUInt32LE(N - 8).toString(16));
console.log('  N-4  u32 self-pointer      = 0x' + buf.readUInt32LE(N - 4).toString(16) + ' (==N-4)');
console.log('  N+0  u32 x                 = ' + buf.readUInt32LE(N));
console.log('  N+4  u32 y                 = ' + buf.readUInt32LE(N + 4));
console.log('  N+8  u32                   = 0x' + buf.readUInt32LE(N + 8).toString(16) + '  (state flags)');
console.log('  N+12 f32                   = ' + buf.readFloatLE(N + 12) + '  (0x' + buf.readUInt32LE(N + 12).toString(16) + ')');
// scan N+16..N+48 for the secUuid that matches ship +5
const shipSec = buf.readUInt32LE(i + 2 + nameLen + 5);
console.log('  ship secUuid to match      = 0x' + shipSec.toString(16));
for (let d = 16; d <= 48; d += 4) {
  const v = buf.readUInt32LE(N + d);
  console.log('  N+' + d + ' u32 = 0x' + v.toString(16) + (v === shipSec ? '   <== MATCHES ship secUuid' : ''));
}

// Confirm secUuid linkage across all single-ship fleets
console.log('\n-- secUuid linkage check across all fleets --');
let ok = 0, tot = 0, matchOff = {};
for (const s of naval) {
  const nl = buf.readUInt16LE(s.offset);
  const sec = buf.readUInt32LE(s.offset + 2 + nl + 5);
  const rec = t4.get(s.fleetUuid);
  if (!rec) continue;
  tot++;
  for (let d = 16; d <= 48; d += 4) {
    if (buf.readUInt32LE(rec.off + d) === sec) { matchOff[d] = (matchOff[d] || 0) + 1; ok++; break; }
  }
}
console.log('  ships whose secUuid found in their type-4 record: ' + ok + '/' + tot);
console.log('  matching offset histogram (N+d): ' + JSON.stringify(matchOff));
