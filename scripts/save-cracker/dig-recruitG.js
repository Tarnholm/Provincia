// Decode the queue entry block (bytes 53..end of default_set body).
// save_1.2 (53B body) = no queue ever. The tail body is mostly zeros with
// occasional 0x01 markers.
// save_2.2 (106B body) = 53 baseline + 53-byte BUILD queue entry
// save_3.2 (88B body) = 53 baseline + 35-byte RECRUIT queue entry

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav'];
const bufs = files.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

function getDSBody(buf) {
  const ds = buf.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1');
  const hr = buf.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1');
  return { body: buf.slice(ds + 12, hr - 10), ds, hr };
}

// Layout hypothesis: bytes +0..+52 = baseline default_set chain entry
// (52 bytes of "this is the default_set chain, count=1, etc.")
// Then bytes +53.. = optional queue entries.
//
// But wait: in save_1.2, baseline body is 53 bytes. The last byte is at +52.
// So if save_2.2 added 53 extra bytes (= queue entry), they're at +53..+105.
// And save_3.2 added 35 extra bytes at +53..+87.

console.log('=== save_2.2 wall queue entry (53 bytes after baseline) ===');
const body2 = getDSBody(bufs[1]).body;
console.log(`  full body length = ${body2.length}; queue entry = bytes [53..${body2.length-1}]`);
const wallEntry = body2.slice(53);
for (let i = 0; i < wallEntry.length; i += 16) {
  const line = wallEntry.slice(i, i+16);
  const hex = Array.from(line).map(x => x.toString(16).padStart(2,'0')).join(' ');
  console.log(`    +${(53+i).toString().padStart(3,'0')}: ${hex}`);
}

console.log('\n=== save_3.2 levies queue entry (35 bytes after baseline) ===');
const body3 = getDSBody(bufs[2]).body;
const levyEntry = body3.slice(53);
for (let i = 0; i < levyEntry.length; i += 16) {
  const line = levyEntry.slice(i, i+16);
  const hex = Array.from(line).map(x => x.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(line).map(x => (x>=0x20 && x<0x7f) ? String.fromCharCode(x) : '.').join('');
  console.log(`    +${(53+i).toString().padStart(3,'0')}: ${hex.padEnd(48)} | ${asc}`);
}

// Now: what is 0x1f40 = 8000 in save_2.2 wall queue?
// Stone wall in RTW EDB has cost ~8000 denarii. Verify by looking at the wall
// queue's three 0x1f40 occurrences: maybe (cost, refund-on-cancel, ???).
console.log('\nKey numbers in wall queue:');
console.log('  0x1f40 = 8000 (likely cost in denarii)');
console.log('  0x16fc84ad (4 bytes at +37) — likely chain UUID');
console.log('  8c 4d 32 2d (queue ID repeats at +41) — matches the default_set hash');

// Now the recruit queue:
// "roman leves" is a 12-char ASCII string with the format:
//   [u16 nameLen=12] [12 bytes ASCII] [\0]
// followed by some fields.
// Find which unit "roman leves" is in the user's EDU. We can decode by counting:
// d2 03 = 978 might be cost.
// ff 00 00 02 = some marker (ff = -1 ? + 0x0200 = recruit-pool?)
// 01 00 00 00 at +29 = quantity to recruit = 1

// But wait: at +29 in save_3.2 BASELINE body (53 bytes section) we see d2 03 00 00
// (= 978) and at +37 there's nothing... let me re-examine.

// The d2 03 appears in BOTH +29 of body (which is within "baseline" 53 bytes)
// AND in the appended queue entry tail. So it's the per-turn cost of levies = 978 denarii?
console.log('\nIn save_3.2 default_set body, d2 03 (= 978) appears at offsets +29 and +83');
const idx29 = body3.indexOf(Buffer.from([0xd2, 0x03, 0, 0]));
console.log(`  first 0xd2 0x03 occurrence at +${idx29}`);
let p = idx29 + 1;
while (true) {
  const n = body3.indexOf(Buffer.from([0xd2, 0x03, 0, 0]), p);
  if (n === -1) break;
  console.log(`  next at +${n}`);
  p = n + 1;
}
