// Direct approach: locate "Roma" settlement in all 4 saves, dump bytes around
// each Roma marker, look for differences specific to the recruitment action.
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav'];
const bufs = files.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

// "Roma" in UTF-16LE = R\0 o\0 m\0 a\0 = 52 00 6f 00 6d 00 61 00
const ROMA = Buffer.from([0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);

function findAll(buf, needle, limit = 50) {
  const hits = [];
  let p = 0;
  while (p < buf.length - needle.length) {
    const idx = buf.indexOf(needle, p);
    if (idx === -1) break;
    hits.push(idx);
    p = idx + 1;
    if (hits.length >= limit) break;
  }
  return hits;
}

for (let i = 0; i < bufs.length; i++) {
  const hits = findAll(bufs[i], ROMA, 200);
  console.log(`${files[i]}: ${hits.length} 'Roma' UTF-16 hits`);
}

// Roma should be character-name as well as settlement-name, plus historic Roma
// references. We want the settlement specifically. The convention from
// session 34 is that settlement names are preceded by a u8 nameflag and
// u8 nameLen=4 and a 0x00 byte. So look for: 04 00 [00] 52 00 6f 00 6d 00 61 00
const ROMA_SET = Buffer.from([0x04, 0, 0, 0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
console.log('\nWith preamble [04 00 00 52 00 6f 00 6d 00 61 00]:');
for (let i = 0; i < bufs.length; i++) {
  const hits = findAll(bufs[i], ROMA_SET, 20);
  console.log(`${files[i]}: ${hits.length} hits: ${hits.map(h => '0x'+h.toString(16)).join(' ')}`);
}

// Try other delimiter — session 34 schema says "01 04 00 R o m a" or
// some variant. Try also [01 04 00 Roma]
const ROMA_SET2 = Buffer.from([0x01, 0x04, 0, 0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
console.log('\nWith preamble [01 04 00 Roma]:');
for (let i = 0; i < bufs.length; i++) {
  const hits = findAll(bufs[i], ROMA_SET2, 20);
  console.log(`${files[i]}: ${hits.length} hits: ${hits.map(h => '0x'+h.toString(16)).join(' ')}`);
}
