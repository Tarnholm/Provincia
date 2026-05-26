// dig-naval-position.js
// The fleetUuid links to: (1) an admiral char record w/ portrait, (2) a graph
// link, (3) the 0xef metadata record at ship i-20. None are type-6 pos records.
// Find the fleet's MAP POSITION. Strategy:
//   A) dump the full 0xef metadata record (className + region "the sea" + look
//      for x,y u32 pairs in range)
//   B) dump the admiral char record (hit#1) and look for x,y
//   C) scan the whole buffer for ANY record whose uuid==fleetUuid AND has a
//      plausible (x,y) pair nearby (x in 0..1100, y in 0..800)

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
const u = naval[0];
const fid = u.fleetUuid;
const target = Buffer.alloc(4); target.writeUInt32LE(fid);

console.log('fleetUuid 0x' + fid.toString(16) + ' for ship @0x' + u.offset.toString(16) + '\n');

// (A) the 0xef metadata record — it's at u.offset-20 region; find 0xef before it
// hit#3 was at ship i-20 = 0x15377ae. The 0xef marker is at -4 of that = 0x15377aa
const efUuidPos = u.offset - 20;
const efMarker = efUuidPos - 4;
console.log('(A) 0xef metadata record (marker @0x' + efMarker.toString(16) + '):');
for (let off = efMarker - 16; off < efMarker + 96; off += 16) {
  console.log('   ' + hexrow(off, 16));
}

// (B) admiral char record — first occurrence of fleetUuid
const adm = buf.indexOf(target, 0);
console.log('\n(B) admiral/char record (first fleetUuid occurrence @0x' + adm.toString(16) + '):');
for (let off = adm - 48; off < adm + 96; off += 16) {
  if (off >= 0) console.log('   ' + hexrow(off, 16));
}

// (C) scan all occurrences, report any with plausible nearby (x,y)
console.log('\n(C) all fleetUuid occurrences with nearby plausible (x,y) pairs:');
let p = 0;
while ((p = buf.indexOf(target, p)) !== -1) {
  // scan +/-40 bytes for an adjacent u32 pair (x,y) where x in [1,1100], y in [1,800]
  for (let d = -40; d <= 40; d += 4) {
    const xo = p + d;
    if (xo < 0 || xo + 8 > buf.length) continue;
    const x = buf.readUInt32LE(xo), y = buf.readUInt32LE(xo + 4);
    if (x >= 1 && x <= 1100 && y >= 1 && y <= 800) {
      console.log('   occ@0x' + p.toString(16) + '  candidate(x=' + x + ',y=' + y + ') @ p' + (d >= 0 ? '+' : '') + d);
    }
  }
  p += 1;
}

// (D) For reference, what (x,y) does a known land army at this faction have?
// Print a few type-6 records to confirm the framing works for land.
console.log('\n(D) sample type-6 position records (first 5):');
let shown = 0;
for (let N = 24; N < buf.length - 16 && shown < 5; N++) {
  if (buf.readUInt32LE(N - 12) !== 6) continue;
  if (buf.readUInt32LE(N - 4) !== N - 4) continue;
  const x = buf.readUInt32LE(N), y = buf.readUInt32LE(N + 4);
  if (x < 1 || x > 1100 || y < 1 || y > 800) continue;
  const uuid = buf.readUInt32LE(N - 8);
  console.log('   pos uuid=0x' + uuid.toString(16) + ' (x=' + x + ',y=' + y + ') @0x' + N.toString(16));
  shown++;
}
