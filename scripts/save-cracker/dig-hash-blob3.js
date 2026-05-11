// Session 23: hash blob #3 — the "hash blob" is actually more 9-byte soldier records.
// (a) Find the actual end of the field-army block by walking 9-byte stride from 0x1f42d28 forward.
// (b) Map the high-entropy 0x1f43800..0x1f44400 region.
// (c) Find where the soldier records end and where the high-entropy section begins.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// (a) The 9-byte soldier stride at 0x1f43000 has pattern: bytes 5..8 always = 00 00 00 00
// bytes 3..4 = stat fields (in {14..17, 20..70})
// byte 0 = state
// bytes 1..2 = u16
// Walk from 0x1f42d28 (likely start of last field-army's soldiers) until pattern breaks.

console.log(`=== Walk 9-byte soldier stride from 0x1f42d28 forward ===`);
let p = 0x1f42d28;
let valid = 0;
let breakpoint = -1;
while (p + 9 < buf.length) {
  // Check the 9-byte record pattern
  const b3 = buf[p + 3], b4 = buf[p + 4];
  const b5 = buf[p + 5], b6 = buf[p + 6], b7 = buf[p + 7], b8 = buf[p + 8];
  // Bytes 5..8 should be 00 00 00 00 (or at most some 0xff terminator)
  const tail5to8 = (b5 === 0 && b6 === 0 && b7 === 0 && b8 === 0);
  // Byte 3 is typically 0x14..0x17 (range observed); byte 4 in {0x10, 0x20, 0x30, ..., 0x70}
  const stat34 = (b3 >= 0x10 && b3 <= 0x1f) && ((b4 & 0x0f) === 0);

  if (tail5to8 && stat34) {
    valid++;
    p += 9;
  } else {
    breakpoint = p;
    break;
  }
}
console.log(`  Valid 9-byte records starting 0x1f42d28: ${valid}`);
console.log(`  Stride broken at 0x${breakpoint.toString(16)}`);
console.log(`  Bytes around break: ${buf.subarray(breakpoint, breakpoint + 32).toString('hex')}`);

// (b) Now also walk 9-byte stride backward to find first valid record (start of soldier list)
// for the "armen..." unit record at 0x1f42cb6.
console.log(`\n=== Walk 9-byte stride backward from 0x1f42d28 ===`);
let q = 0x1f42d28;
let backValid = 0;
while (q - 9 > 0x1f42cb0) {
  const b3 = buf[q - 9 + 3], b4 = buf[q - 9 + 4];
  const b5 = buf[q - 9 + 5], b6 = buf[q - 9 + 6], b7 = buf[q - 9 + 7], b8 = buf[q - 9 + 8];
  const tail5to8 = (b5 === 0 && b6 === 0 && b7 === 0 && b8 === 0);
  const stat34 = (b3 >= 0x10 && b3 <= 0x1f) && ((b4 & 0x0f) === 0);
  if (tail5to8 && stat34) {
    backValid++;
    q -= 9;
  } else {
    console.log(`  Stride breaks backward at 0x${q.toString(16)} (record before: ${buf.subarray(q - 16, q).toString('hex')})`);
    break;
  }
}
console.log(`  Records preceding 0x1f42d28: ${backValid}`);

// (c) Hex dump around the break point in (a) to see what comes after the soldier records
if (breakpoint > 0) {
  console.log(`\n=== Hex dump around stride break (0x${breakpoint.toString(16)}, ±64B) ===`);
  for (let off = breakpoint - 64; off < breakpoint + 256; off += 16) {
    const slice = buf.subarray(off, off + 16);
    const hex = slice.toString('hex').match(/.{2}/g).join(' ');
    const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}`);
  }
}

// (d) Show the actual region transition into the "settlement_model strings"
// from session 14's data, settlement strings start at 0x1f47abd.
// Let's see what's between the soldier records' end (breakpoint) and 0x1f47abd.
console.log(`\n=== Region between soldier records' end and settlement model strings ===`);
console.log(`  Stride break at: 0x${breakpoint.toString(16)}`);
console.log(`  Settlement model strings start (session 14): 0x1f47abd`);
console.log(`  Gap size: ${0x1f47abd - breakpoint} bytes`);

console.log(`\n=== Dump 0x1f43800..0x1f43900 (high-entropy zone start) ===`);
for (let off = 0x1f43800; off < 0x1f43900; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`  0x${off.toString(16)}: ${hex}`);
}
