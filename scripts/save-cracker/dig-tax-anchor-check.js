// dig-tax-anchor-check.js
//
// Two different anchors are in play:
//   (A) buildingParser.findAllSettlementMarkers => returns `offset` = the FLAG
//       byte position, where layout is [flag][nchars][0x00][UTF-16...].
//   (B) the tax diff scripts => anchor on the pstr16 LENGTH-PREFIX, i.e. the
//       [u16 len] little-endian word that precedes the UTF-16 name.
//
// These are NOT the same byte. We need to know the exact relationship so the
// app (which uses findAllSettlementMarkers) can read tax at the right dx.
//
// findAllSettlementMarkers layout: byte0=flag(0x01/0x00), byte1=nchars,
//   byte2=0x00, then UTF-16. So the [u16 len] word is bytes [nchars, 0x00] at
//   marker.offset+1 .. +2. The "pstr16 prefix" the diff scripts use is
//   marker.offset+1 (the low byte = nchars, high byte = 0x00). => prefixPos =
//   marker.offset + 1.  Therefore tax dx relative to marker.offset =
//   (-562) + 1 = -561 ... we VERIFY this empirically below.
//
// Read-only.

const fs = require('fs');
const path = require('path');
const { findAllSettlementMarkers } = require('../../src/buildingParser');

const ALEX = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

function findUtf16Prefix(buf, str, from = 0) {
  const t = Buffer.alloc(2 + str.length * 2);
  t.writeUInt16LE(str.length, 0);
  for (let i = 0; i < str.length; i++) t.writeUInt16LE(str.charCodeAt(i), 2 + i * 2);
  return buf.indexOf(t, from);
}

const buf = fs.readFileSync(path.join(ALEX, 'save_17-05-2026   Macedon   Turn 1.sav'));

for (const name of ['Pella', 'Sparta']) {
  const prefixPos = findUtf16Prefix(buf, name);
  const markers = findAllSettlementMarkers(buf).filter(m => m.name === name);
  console.log('\n%s', name);
  console.log('  pstr16 prefixPos (diff-script anchor) = 0x%s', prefixPos.toString(16));
  for (const m of markers) {
    console.log('  marker.offset (findAllSettlementMarkers) = 0x%s   delta(prefixPos - marker.offset)=%d',
      m.offset.toString(16), prefixPos - m.offset);
  }
  console.log('  tax @ prefixPos-562 = %d', buf[prefixPos - 562]);
  // What dx from marker.offset reproduces the same byte?
  const m = markers[0];
  if (m) console.log('  tax @ marker.offset+(%d) = %d',
    (prefixPos - 562) - m.offset, buf[prefixPos - 562]);
}
