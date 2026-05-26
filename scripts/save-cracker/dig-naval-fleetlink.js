// dig-naval-fleetlink.js
// Find what record the naval fleetUuid actually links to.
// For each naval ship's fleetUuid, locate ALL occurrences in the buffer and
// classify the surrounding bytes (type-6 pos record? 0xef metadata? something
// with x,y?). Also check whether the SAME fleetUuid resolves to a position
// some other way.

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

const all = findUnitRecords(buf);
const naval = all.filter(u => /^naval\b/i.test(u.name) && u.fleetUuid).sort((a, b) => a.offset - b.offset);

console.log(fname + ' — investigating fleetUuid links for first 3 fleets\n');

for (const u of naval.slice(0, 3)) {
  const fid = u.fleetUuid;
  console.log('==== fleetUuid 0x' + fid.toString(16) + ' (ship "' + u.name + '" @0x' + u.offset.toString(16) + ') ====');
  const target = Buffer.alloc(4);
  target.writeUInt32LE(fid);
  let p = 0, hits = 0;
  while ((p = buf.indexOf(target, p)) !== -1 && hits < 12) {
    hits++;
    // classify: what's before/after?
    const pre12 = p >= 12 ? buf.readUInt32LE(p - 12) : -1;
    const pre8 = p >= 8 ? buf.readUInt32LE(p - 8) : -1;
    const pre4 = p >= 4 ? buf.readUInt32LE(p - 4) : -1;
    const post4 = buf.readUInt32LE(p + 4);
    const post8 = buf.readUInt32LE(p + 8);
    let tag = '';
    // type-6 position record: u32(p-12)=6? Actually pos record has uuid at N-8,
    // so if THIS is the uuid, the marker 6 is at p-4 and self-ptr at p+4 and x at p+8.
    // Let's check several framings.
    if (buf.readUInt32LE(p - 4) === 6 && buf.readUInt32LE(p + 4) === (p + 4)) tag += '[POS6 uuid: x=' + buf.readUInt32LE(p + 8) + ' y=' + buf.readUInt32LE(p + 12) + '] ';
    if (pre4 === 0xef) tag += '[0xef-metadata uuid] ';
    console.log('  hit#' + hits + ' @0x' + p.toString(16) + '  pre[-12,-8,-4]=' +
      pre12 + ',' + pre8 + ',' + pre4 + '  post[+4,+8]=' + post4 + ',' + post8 + '  ' + tag);
    p += 1;
  }
  console.log('  total occurrences (capped at 12): ' + hits);
  // Show a wide dump around the FIRST hit
  if (hits > 0) {
    p = buf.indexOf(target, 0);
    console.log('  -- dump around first occurrence --');
    for (let off = p - 32; off < p + 48; off += 16) {
      if (off >= 0) console.log('     ' + hexrow(off, 16));
    }
  }
  console.log('');
}
