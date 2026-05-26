// dig-naval-faction.js
// Attribute each fleet to its owning faction.
// Candidate signals:
//   (1) The 0xef metadata record carries className like "<culture> admiral" /
//       "<culture> captain" — the culture token hints at faction group.
//   (2) The admiral char record (first fleetUuid occurrence) embeds a portrait
//       path and sits inside a faction's character block.
//   (3) The type-4 record itself may carry a faction id byte.
//   (4) Offset window: ships are file-ordered; do they cluster by faction the
//       same way the 23 major records do? Probably not (they're in a global
//       world-object zone). Check by comparing ship offsets to major-record
//       offset windows.
//
// Also: dump the className from each 0xef metadata record for all fleets.

const fs = require('fs');
const path = require('path');
const { findUnitRecords } = require('C:/dev/Provincia/src/unitParser.js');
const { parseFactionTreasuries } = require('C:/dev/Provincia/src/saveCrackerExtras.js');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const fname = 'save_macedon t0.sav';
const buf = fs.readFileSync(path.join(BASE, fname));

function hexrow(off, n) {
  const hex = Array.from(buf.slice(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(buf.slice(off, off + n)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  return '0x' + off.toString(16) + ': ' + hex + '  |' + asc + '|';
}

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

// read a pstr16 ASCIIZ at off (len-prefixed u16, includes null)
function readPstr16(off) {
  const len = buf.readUInt16LE(off);
  if (len < 2 || len > 60) return null;
  if (off + 2 + len > buf.length) return null;
  if (buf[off + 2 + len - 1] !== 0) return null;
  let s = '';
  for (let i = 0; i < len - 1; i++) {
    const c = buf[off + 2 + i];
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s;
}

const t4 = parseType4(buf);
const all = findUnitRecords(buf);
const naval = all.filter(u => /^naval\b/i.test(u.name)).sort((a, b) => a.offset - b.offset);
const fr = parseFactionTreasuries(buf);
const firstMajor = fr.length ? fr[0].offset : buf.length;
console.log('first major faction record @0x' + firstMajor.toString(16) + ' | naval first @0x' + naval[0].offset.toString(16) + '\n');

// distinct fleets
const seen = new Set(); const fleets = [];
for (const u of naval) { if (u.fleetUuid && t4.has(u.fleetUuid) && !seen.has(u.fleetUuid)) { seen.add(u.fleetUuid); fleets.push(u); } }

// (1) className from 0xef metadata record (it's right at ship i-24..)
// The 0xef record: marker @ (i-24), uuid @ (i-20), then className pstr16 a bit later.
console.log('--- className in 0xef metadata record per fleet (first 10) ---');
for (const u of fleets.slice(0, 10)) {
  const efMarker = u.offset - 24;
  // find pstr16 className in window efMarker+0x10 .. efMarker+0x40 (like main.js)
  let cls = null;
  for (let p = efMarker + 0x10; p < efMarker + 0x44; p++) {
    const s = readPstr16(p);
    if (s && /[a-z]/.test(s) && s.length > 3 && !/^naval/.test(s)) { cls = s; break; }
  }
  console.log('  fleet 0x' + u.fleetUuid.toString(16) + '  className=' + JSON.stringify(cls));
}

// (2) admiral char record: dump className/portrait + find the faction.
console.log('\n--- admiral char record (first fleetUuid occurrence) for first 3 fleets ---');
for (const u of fleets.slice(0, 3)) {
  const target = Buffer.alloc(4); target.writeUInt32LE(u.fleetUuid);
  const adm = buf.indexOf(target, 0);
  console.log('\n  fleet 0x' + u.fleetUuid.toString(16) + ' admiral record @0x' + adm.toString(16) + ':');
  for (let off = adm - 64; off < adm + 32; off += 16) if (off >= 0) console.log('     ' + hexrow(off, 16));
  // look backward for a pstr16 portrait/class
}

// (3) Does the type-4 record carry a faction byte? dump around it.
console.log('\n--- type-4 record dump for first 3 fleets ---');
for (const u of fleets.slice(0, 3)) {
  const N = t4.get(u.fleetUuid).off;
  console.log('\n  fleet 0x' + u.fleetUuid.toString(16) + ' type-4 @0x' + N.toString(16) + ' (x=' + t4.get(u.fleetUuid).x + ',y=' + t4.get(u.fleetUuid).y + '):');
  for (let off = N - 16; off < N + 80; off += 16) if (off >= 0) console.log('     ' + hexrow(off, 16));
}
