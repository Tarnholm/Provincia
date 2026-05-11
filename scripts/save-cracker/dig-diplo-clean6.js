// Session 32 step 6: investigate the diplomacy enum location.
// AREA 1 @ 0x103200..0x103300 and AREA 2 @ 0xa77550..0xa77650 have IDENTICAL byte content
// EXCEPT for one byte that flipped 05 -> 01.
// AREA 1: offset 0x103286 (byte 0x05/0x01)
// AREA 2: offset 0xa775de (byte 0x05/0x01)
// Both appear in a structured 32-byte record:
//   [pad]... 00 ENUM 00 00 00 00 0a 00 00 00 c8 00 00 00 c8 00 00 00 02 00 00 00 06 00 00 00 c8 00 00 00 ...
// Let's find every occurrence of the surrounding signature in both files.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

// Signature: the bytes AFTER the enum should match in both files.
// At 0x103286: enum at +0, then "00 00 00 00 0a 00 00 00 c8 00 00 00 c8 00 00 00 02 00 00 00 06 00 00 00 c8 00 00 00"
// = 8 u32le words: enum, 0, 10 (0x0a), 200 (0xc8), 200, 2, 6, 200
// Look for that signature.

const sig = Buffer.from([
  0x00, 0x00, 0x00, 0x00, // 0 (4 bytes after enum)
  0x0a, 0x00, 0x00, 0x00, // 10
  0xc8, 0x00, 0x00, 0x00, // 200
  0xc8, 0x00, 0x00, 0x00, // 200
  0x02, 0x00, 0x00, 0x00, // 2
  0x06, 0x00, 0x00, 0x00, // 6
  0xc8, 0x00, 0x00, 0x00, // 200
]);

console.log(`Searching for signature (length=${sig.length}) in both files...`);
const aHits = [];
const bHits = [];
for (let i = 0; i < a.length - sig.length; i++) {
  if (a.compare(sig, 0, sig.length, i, i + sig.length) === 0) aHits.push(i);
}
for (let i = 0; i < b.length - sig.length; i++) {
  if (b.compare(sig, 0, sig.length, i, i + sig.length) === 0) bHits.push(i);
}
console.log(`A hits: ${aHits.length}, B hits: ${bHits.length}`);

// Print enum value (byte before signature - 4) and surrounding context for each.
function previewAround(buf, off, before = 24, after = 24) {
  const start = Math.max(0, off - before);
  const end = Math.min(buf.length, off + after);
  const slice = buf.slice(start, end);
  return Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
}

function readU32(buf, off) {
  return buf.readUInt32LE(off);
}

console.log(`\n=== A hits (sig starts at offset; enum is at -4) ===`);
for (const off of aHits) {
  const enumOff = off - 4;
  const enumVal = readU32(a, enumOff);
  console.log(`  sigStart=0x${off.toString(16)} enumOff=0x${enumOff.toString(16)} enum=${enumVal}`);
  console.log(`    ${previewAround(a, off, 24, 24)}`);
}

console.log(`\n=== B hits ===`);
for (const off of bHits) {
  const enumOff = off - 4;
  const enumVal = readU32(b, enumOff);
  console.log(`  sigStart=0x${off.toString(16)} enumOff=0x${enumOff.toString(16)} enum=${enumVal}`);
  console.log(`    ${previewAround(b, off, 24, 24)}`);
}

// Compare hits between A and B (B may be shifted -10 in latter half).
console.log(`\n=== Pairing A vs B hits (by approximate offset) ===`);
for (const aOff of aHits) {
  // Find closest B offset (within 32 bytes of aOff or aOff-10).
  let bOff = bHits.find(b => Math.abs(b - aOff) < 32);
  if (!bOff) bOff = bHits.find(b => Math.abs(b - (aOff - 10)) < 32);
  if (!bOff) { console.log(`  A@0x${aOff.toString(16)} -> no B match`); continue; }
  const aEnum = readU32(a, aOff - 4);
  const bEnum = readU32(b, bOff - 4);
  const flag = aEnum !== bEnum ? ' *** FLIPPED ***' : '';
  console.log(`  A@0x${aOff.toString(16)} enum=${aEnum}   B@0x${bOff.toString(16)} enum=${bEnum}${flag}`);
}
