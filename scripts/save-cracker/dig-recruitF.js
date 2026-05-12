// Verify: is save_4.2's default_set body actually identical to save_1.2's?
// And is save_4.2 actually different from save_2.2 (which is the *prior* save before the diplomat move)?
// Wait the brief says save_3.2 -> save_4.2 is the diplomat move. So save_4.2 has the levies queue
// from save_3.2 still active OR... let me re-read.
//
// Per the brief:
//   save_1.2 baseline
//   save_2.2: queue 1 stone wall in Roma   (delta +166KB from save_1.2)
//   save_3.2: queue 1 levies (unit)         (delta -18B from save_2.2)
//   save_4.2: move diplomat 2 tiles south   (delta +89B from save_3.2)
//
// So save_4.2 should have BOTH the wall AND the levies queued, OR these are alternate
// branches from save_1.2... but the file sizes (34690853, 34690835, 34690924) increase from
// save_2->3 if no rollback. -18+89 = +71. save_2.2.length+71 = 34690924 = save_4.2 ✓.
// So they're SEQUENTIAL. After save_3.2 (levies queued), save_4.2 should ALSO have the
// levies queue active (no end-turn happened).
//
// But save_4.2's body bytes at 0xf8465a look like save_1.2's = empty queue!
// Wait save_4.2 body bytes: 5a 46 f8 00 8c 4d 32 2d fc fc fc fc 1d 01 00 00 94 01 00 00 01 00 ...zeros... 01 00 00 00
// The hash 8c 4d 32 2d matches save_2.2 (NOT save_3.2's 9a 0c ba a0).
// So save_4.2 INHERITED the queue state from... save_2.2?? That's weird unless save_3.2 was
// not committed before save_4 was taken, or the brief description is off, or the queue
// stayed but only the UUID rolled back.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav'];
const bufs = files.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

// First, find each save's "default_set" record body
function getDSBody(buf) {
  const ds = buf.indexOf(Buffer.from('default_set\0'), 0xf84600, 'latin1');
  const hr = buf.indexOf(Buffer.from('hinterland_region\0'), 0xf84600, 'latin1');
  return buf.slice(ds + 12, hr - 10);
}

const bodies = bufs.map(getDSBody);
for (let i = 0; i < files.length; i++) {
  console.log(`${files[i]}: default_set body = ${bodies[i].length} bytes`);
}
console.log();
// Compare each pair byte-by-byte (smallest = save_1.2 and save_4.2, both 53 bytes)
console.log(`save_1.2 body and save_4.2 body byte-by-byte:`);
for (let i = 0; i < Math.min(bodies[0].length, bodies[3].length); i++) {
  if (bodies[0][i] !== bodies[3][i]) {
    console.log(`  diff at +${i}: save_1=0x${bodies[0][i].toString(16)} save_4=0x${bodies[3][i].toString(16)}`);
  }
}
console.log('(end of save_1 vs save_4 diff scan)');

// Now show all 4 bodies hex side by side at offset +0..+53
console.log('\nFirst 53 bytes of default_set body (all 4 saves):');
console.log('  offset  save_1.2          save_2.2          save_3.2          save_4.2');
for (let i = 0; i < 53; i++) {
  const b1 = bodies[0][i] || 0;
  const b2 = bodies[1][i] || 0;
  const b3 = bodies[2][i] || 0;
  const b4 = bodies[3][i] || 0;
  const marker = [b1, b2, b3, b4].every(x => x === b1) ? '   ' : '*** ';
  console.log(`  +${i.toString().padStart(2,'0')}     ${b1.toString(16).padStart(2,'0')}                ${b2.toString(16).padStart(2,'0')}                ${b3.toString(16).padStart(2,'0')}                ${b4.toString(16).padStart(2,'0')}  ${marker}`);
}
