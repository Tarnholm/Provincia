// Per session 34, Roma settlement record marker has the schema:
//   marker_offset-8..-5: 0xef000000
//   marker_offset-4..-1: 0x00010400
//   marker_offset+0:     0x01 (name flag)
//   marker_offset+1:     name length (chars)
//   marker_offset+2:     0x00
//   marker_offset+3..:   UTF-16LE name
// For Roma: marker+1 = 4 (chars), marker+3.. = "Roma"
// So the signature is: ef 00 00 00 00 01 04 00 01 04 00 R o m a (UTF16)
const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav'];
const bufs = files.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

const sig = Buffer.from([0xef, 0, 0, 0, 0x00, 0x01, 0x04, 0x00, 0x01, 0x04, 0, 0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
// Actually let me try variations: session 34 said "marker offset = 0x01 flag",
// so the signature is just the trailing 0x00 0x01 0x04 0x00 0x01 0x04 0x00 R o m a part.
// And the 4 bytes before that (marker-4..-1) are 0x00010400 LE = bytes [00 04 01 00].
// And marker-8..-5 = ef 00 00 00.

// Even simpler: scan all 0x01 [0x04] 0x00 [Roma utf16] anywhere
const SIG1 = Buffer.from([0x01, 0x04, 0x00, 0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
console.log('Sig [01 04 00 Roma utf16]:');
for (let i = 0; i < bufs.length; i++) {
  const b = bufs[i];
  const hits = [];
  let p = 0;
  while (p < b.length - SIG1.length) {
    const idx = b.indexOf(SIG1, p);
    if (idx === -1) break;
    hits.push(idx);
    p = idx + 1;
  }
  console.log(`  ${files[i]}: ${hits.length}: ${hits.map(h => '0x'+h.toString(16)).join(' ')}`);
}

// session 34's example: Uria marker had byte sequence ending with `... ef000000  00010400 01 04 00 Uria`
// Pattern is "0x010400 [u8 nameflag=01] [u8 length=4] [u8 00] [utf16le name]"
// Search for [00 01 04 00 01 04 00] Roma
const SIG2 = Buffer.from([0x00, 0x01, 0x04, 0, 0x01, 0x04, 0, 0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
console.log('\nSig [00 01 04 00 01 04 00 Roma utf16]:');
for (let i = 0; i < bufs.length; i++) {
  const b = bufs[i];
  const hits = [];
  let p = 0;
  while (p < b.length - SIG2.length) {
    const idx = b.indexOf(SIG2, p);
    if (idx === -1) break;
    hits.push(idx);
    p = idx + 1;
  }
  console.log(`  ${files[i]}: ${hits.length}: ${hits.map(h => '0x'+h.toString(16)).join(' ')}`);
}

// Maybe the name is "Roma" but with a different nameflag (00).
const SIG3 = Buffer.from([0x00, 0x04, 0, 0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
console.log('\nSig [00 04 00 Roma utf16]:');
for (let i = 0; i < bufs.length; i++) {
  const b = bufs[i];
  const hits = [];
  let p = 0;
  while (p < b.length - SIG3.length) {
    const idx = b.indexOf(SIG3, p);
    if (idx === -1) break;
    hits.push(idx);
    p = idx + 1;
  }
  console.log(`  ${files[i]}: ${hits.length}: ${hits.map(h => '0x'+h.toString(16)).join(' ')}`);
}
