// Session 23: hash blob #5 — pin the exact size of the 16-byte-stride "value=3" array
// and the high-entropy zone size. Also test the hypothesis that the high-entropy zone
// has a structured record size (8B, 16B, 32B?).

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// (a) Detect 16-byte stride array of [16-byte records ending with 03 00 00 00 00 00 00 00 00 00 ...]
// Hypothesis: it's [u32 zero][u32 zero][u32 zero=3][u32 zero] = 16 bytes, all zeros except +12 = 3
console.log(`=== 16-byte stride records starting ~0x1f442e8 ===`);

// First find start: walk forward from 0x1f442e8 looking for the pattern
let recStart = 0x1f442e8;
console.log(`Bytes 0x${recStart.toString(16)}..0x${(recStart+64).toString(16)}: ${buf.subarray(recStart, recStart + 64).toString('hex')}`);

// Pattern check: starting at recStart, every 16 bytes, +12..+15 should be 03 00 00 00
let count = 0;
let p = recStart;
while (p + 16 < buf.length) {
  // u32 LE at +12 must be 3
  if (buf.readUInt32LE(p + 12) === 3) {
    count++;
    p += 16;
  } else {
    break;
  }
}
console.log(`Stride records found: ${count}`);
console.log(`Array ends at: 0x${p.toString(16)} (last byte before: ${buf.subarray(p - 4, p + 16).toString('hex')})`);
console.log(`Array length: ${p - recStart} bytes`);

// (b) What comes after the 16B stride array?
console.log(`\n=== Hex dump at array end (0x${p.toString(16)}..0x${(p+128).toString(16)}) ===`);
for (let off = p; off < p + 256; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}`);
}

// (c) Try to detect: is the high-entropy zone 0x1f43898..0x1f441a0 a flat hash array?
// Test 8B, 16B, 32B stride uniqueness
const heStart = 0x1f43898, heEnd = 0x1f441a0;
console.log(`\n=== High-entropy zone analysis 0x${heStart.toString(16)}..0x${heEnd.toString(16)} (${heEnd - heStart} bytes) ===`);

for (const stride of [8, 16, 32, 64]) {
  if ((heEnd - heStart) % stride !== 0) continue;
  const nRecs = (heEnd - heStart) / stride;
  const set = new Set();
  for (let i = 0; i < nRecs; i++) {
    set.add(buf.subarray(heStart + i * stride, heStart + (i + 1) * stride).toString('hex'));
  }
  console.log(`  Stride ${stride}B: ${nRecs} records, ${set.size} unique ${set.size === nRecs ? '(all unique)' : ''}`);
}

// (d) Look at 0x1f442b0..0x1f442e8 — that 56-byte region between the UUID-list and the value=3 array
console.log(`\n=== Transition zone 0x1f44270..0x1f442f0 ===`);
for (let off = 0x1f44270; off < 0x1f442f0; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  console.log(`  0x${off.toString(16)}: ${hex}`);
}

// (e) The UUIDs 79 42 f4 01, 85 42 f4 01, ... look like sequence "0x01f44279, 0x01f44285, 0x01f4428a, 0x01f44296, ..."
// These are file offsets! Let's check.
console.log(`\n=== Test: are those "42 f4 01" values self-pointers? ===`);
for (let off = 0x1f4426c; off < 0x1f442c0; off += 4) {
  const v = buf.readUInt32LE(off);
  const isPlausibleOff = v > 0x1f00000 && v < 0x2200000;
  console.log(`  0x${off.toString(16)}: u32 = 0x${v.toString(16)}${isPlausibleOff ? `  (plausible offset; self-distance=${v - off})` : ''}`);
}
