// Session 73 — Parse trailer (wonders) section at 0xa8b37..0xa8beb

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(SAV);

const TRAILER_START = 0xa8b37;
const END = 0xa8beb;

console.log('Trailer: ' + (END - TRAILER_START) + ' bytes');
console.log('Hex dump:');
for (let o = TRAILER_START; o < END; o += 16) {
  const slice = buf.subarray(o, Math.min(o + 16, END));
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  console.log('  0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + ascii);
}

// 0xa8b37: 01 01 -- looks like part of preceding record? Or section preamble?
// 0xa8b39: 07 00 14 00 -- could be u16=7 + u16=20 (lenPlus1 for next?) OR u16=7 + 14 00 (name? prefix?)
// Hmm. Actually: 07 00 = u16 len 7, then "pyramids_and_sphinx" = 19 chars + nul = 20. So 07 should be 20+1 = 0x15?
// Let me look: 07 00 14 00 70 79 72 61 6d 69 64 73 5f 61 6e 64 5f 73 70 68 69 6e 78 00
// 07 00 = 7
// 14 00 = 20
// Then "pyramids_and_sphinx\0" = 20 bytes
// So format: [u16 ?=7][u16 lenP1=20][string][...]
// 7 might be a count or fixed magic

// Try parsing the wonder records
function readPstr16(o) {
  if (o + 2 > END) return null;
  const lenP1 = buf.readUInt16LE(o);
  if (lenP1 < 1 || lenP1 > 128) return null;
  if (o + 2 + lenP1 > END) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[o + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[o + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(o + 2, o + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Find all pstr16 in trailer
console.log('\nAll pstr16 in trailer:');
for (let o = TRAILER_START; o < END; o++) {
  const r = readPstr16(o);
  if (r) console.log('  0x' + o.toString(16) + ' "' + r.str + '" (totalLen=' + r.totalLen + ')');
}

// Trailer format: starts at 0xa8b37, ends at 0xa8beb
// 01 01 -- 2 bytes preamble
// then loops: [u16 ?=7][pstr16 name][12B payload]
// 7 wonders => 7 records

// Let me walk from 0xa8b39 (skipping 2-byte preamble)
console.log('\n=== Walking wonders ===');
let p = 0xa8b39;
let count = 0;
while (p < END - 4) {
  const w = buf.readUInt16LE(p);
  // expect 7 = some kind?
  console.log('  0x' + p.toString(16) + ' u16=' + w);
  p += 2;
  const r = readPstr16(p);
  if (!r) {
    console.log('  No pstr16 here, breaking');
    break;
  }
  p += r.totalLen;
  console.log('    name="' + r.str + '"');
  // 12B payload — but mausoleum has 12B then what?
  // Let me read 12B
  const payload = buf.slice(p, p + 12);
  console.log('    payload: ' + Array.from(payload).map(b=>b.toString(16).padStart(2,'0')).join(' '));
  p += 12;
  count++;
  if (count > 10) break;
}
console.log('Walked ' + count + ' wonders');
console.log('Position after walk: 0x' + p.toString(16) + ' (END=0x' + END.toString(16) + ')');
console.log('Tail-of-trailer: ' + (END - p) + ' bytes');
if (p < END) {
  const tail = buf.slice(p, END);
  console.log('  bytes: ' + Array.from(tail).map(b=>b.toString(16).padStart(2,'0')).join(' '));
}
