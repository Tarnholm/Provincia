// dig-siege7.js
// Pin down the siege block structure precisely:
//   - Where is 0x152f529 within the file? What section?
//   - Where is 0x12d8724? Is that a settlement or army record?
//   - What's the 4-byte u32 at the siege block's tail (`d5 08 00 00` = 2261)?
//
// Also: characterize the Brundisium siege block in save_7 by finding a similar
// 73-byte unique insertion vs save_9 (which has no sieges).

const fs = require('fs');
const path = require('path');
const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const s6 = fs.readFileSync(path.join(SAVES_DIR,'save_6.1.sav'));
const s7 = fs.readFileSync(path.join(SAVES_DIR,'save_7.1.sav'));
const s8 = fs.readFileSync(path.join(SAVES_DIR,'save_8.1.sav'));
const s9 = fs.readFileSync(path.join(SAVES_DIR,'save_9.1.sav'));

// In save_8 the siege block UUID is `70 93 a6 7b e0 0e 7f 3d eb 2a c9 95`.
// The first 4 bytes (70 93 a6 7b) are referenced elsewhere in save_8 (at 0x12d8723).
// Confirm this by finding all occurrences in each save.

const SIEGE_UUID_4 = Buffer.from([0x70, 0x93, 0xa6, 0x7b]);
const SIEGE_UUID_12 = Buffer.from([0x70,0x93,0xa6,0x7b,0xe0,0x0e,0x7f,0x3d,0xeb,0x2a,0xc9,0x95]);

function findAll(buf, pat, limit=20) {
  const hits=[]; let i=0;
  while (i + pat.length <= buf.length) {
    const k = buf.indexOf(pat, i);
    if (k<0) break;
    hits.push(k);
    i = k+1;
    if (hits.length>=limit) break;
  }
  return hits;
}

console.log('Hits of save_8 siege UUID-4 (70 93 a6 7b):');
for (const [l,b] of [['s6',s6],['s7',s7],['s8',s8],['s9',s9]]) console.log(`  ${l}: ${findAll(b,SIEGE_UUID_4).map(h=>'0x'+h.toString(16)).join(',') || '(none)'}`);
console.log('Hits of save_8 siege UUID-12:');
for (const [l,b] of [['s6',s6],['s7',s7],['s8',s8],['s9',s9]]) console.log(`  ${l}: ${findAll(b,SIEGE_UUID_12).map(h=>'0x'+h.toString(16)).join(',') || '(none)'}`);

// Now find the analogous siege block in save_7 (Brundisium siege start) by
// looking for the same STRUCTURE: a 13-byte block "01 XX XX XX XX XX XX XX XX XX XX XX XX"
// not present in save_6, and a corresponding 4-byte reference.
//
// Approach: scan save_7 looking for byte patterns "01 XX XX XX XX 00 00 00..." that:
// 1. Are NOT present in save_6
// 2. Are followed by a 52-byte zero region
// 3. Are followed by a u32 trailer like the siege count

// Simpler: find all locations in save_7 where we have the pattern
// "[16+ bytes of FF or 00] [01 UUID_12] [52 zeros] [u32]" — this matches
// the siege block layout from save_8.

// Look for "01 [12 random bytes] 00*52 [u32 trailer]" anywhere in save_7
// that is NOT present in save_6. Specifically, scan save_7 for byte pattern:
// at offset X: byte == 0x01
// at X+13..X+64 (52 bytes): all zero
// at X+65..X+68: any u32 (likely small)
// at X+69..X+92: zeros

console.log('\nScanning save_7 for SIEGE-like blocks: 01 X*12 00*52 [u32] ...');
function isSiegeLike(buf, off) {
  if (off + 80 > buf.length) return false;
  if (buf[off] !== 0x01) return false;
  // skip 12-byte UUID — accept any
  // bytes 13..64 must be zeros (52 zero bytes)
  for (let k = 13; k < 65; k++) if (buf[off+k] !== 0) return false;
  // byte 65..68: u32 trailer; require some non-zero (otherwise too many false positives)
  const trail = buf.readUInt32LE(off+65);
  if (trail === 0 || trail > 0x10000) return false; // 1..65535
  // a few more zeros after
  for (let k = 69; k < 73; k++) if (buf[off+k] !== 0) return false;
  return true;
}
const hits7 = [];
for (let off = 0; off + 80 <= s7.length; off++) {
  if (isSiegeLike(s7, off)) hits7.push(off);
}
console.log(`save_7: found ${hits7.length} siege-like blocks (first 20):`);
for (const o of hits7.slice(0,20)) {
  const uuid = s7.slice(o+1, o+13).toString('hex');
  const trail = s7.readUInt32LE(o+65);
  console.log(`  0x${o.toString(16)}  uuid=${uuid}  trailer_u32=${trail}`);
}
// Cross-check: same scan in save_6 and save_9
const hits6 = [];
for (let off = 0; off + 80 <= s6.length; off++) if (isSiegeLike(s6, off)) hits6.push(off);
console.log(`save_6: ${hits6.length} siege-like blocks (first 20):`);
for (const o of hits6.slice(0,20)) console.log(`  0x${o.toString(16)}  uuid=${s6.slice(o+1,o+13).toString('hex')}  trail=${s6.readUInt32LE(o+65)}`);
const hits9 = [];
for (let off = 0; off + 80 <= s9.length; off++) if (isSiegeLike(s9, off)) hits9.push(off);
console.log(`save_9: ${hits9.length} siege-like blocks (first 20):`);
for (const o of hits9.slice(0,20)) console.log(`  0x${o.toString(16)}  uuid=${s9.slice(o+1,o+13).toString('hex')}  trail=${s9.readUInt32LE(o+65)}`);
const hits8 = [];
for (let off = 0; off + 80 <= s8.length; off++) if (isSiegeLike(s8, off)) hits8.push(off);
console.log(`save_8: ${hits8.length} siege-like blocks (first 20):`);
for (const o of hits8.slice(0,20)) console.log(`  0x${o.toString(16)}  uuid=${s8.slice(o+1,o+13).toString('hex')}  trail=${s8.readUInt32LE(o+65)}`);

// Compute the SET DIFFERENCE:
// blocks unique to save_8 vs save_9 (should include the Tarentum siege block we found)
// blocks unique to save_7 vs save_6 (should be the Brundisium siege block)
function uniqueBlocks(arr, refSet) {
  // since blocks may be at different file offsets due to shifts, key by UUID
  return arr.filter(o => true);
}
const uuidsIn = (buf, hits) => new Set(hits.map(o => buf.slice(o+1, o+13).toString('hex')));
const u6 = uuidsIn(s6, hits6), u7 = uuidsIn(s7, hits7), u8 = uuidsIn(s8, hits8), u9 = uuidsIn(s9, hits9);
console.log('\nUUIDs unique to save_7 (siege blocks NOT in save_6): expect 1, = Brundisium siege');
const newIn7 = [...u7].filter(u => !u6.has(u));
console.log(`  ${newIn7.length} new UUIDs: ${newIn7.slice(0,5).join(', ')}`);
console.log('UUIDs unique to save_8 (siege blocks NOT in save_7): expect 1, = Tarentum siege');
const newIn8 = [...u8].filter(u => !u7.has(u));
console.log(`  ${newIn8.length} new UUIDs: ${newIn8.slice(0,5).join(', ')}`);
console.log('UUIDs in save_8 but NOT in save_9 (sieges in 8 that ended in 9): expect 1, = Tarentum');
const onlyIn8 = [...u8].filter(u => !u9.has(u));
console.log(`  ${onlyIn8.length}: ${onlyIn8.slice(0,5).join(', ')}`);
console.log('UUIDs in save_7 but NOT in save_9 (sieges in 7 that ended in 9): expect 1, = Brundisium');
const onlyIn7vs9 = [...u7].filter(u => !u9.has(u));
console.log(`  ${onlyIn7vs9.length}: ${onlyIn7vs9.slice(0,5).join(', ')}`);

// Print full context for the Brundisium siege block UUID found in save_7
if (newIn7.length > 0 && newIn7.length < 5) {
  for (const uuidHex of newIn7) {
    const uuidBuf = Buffer.from(uuidHex, 'hex');
    const idx = s7.indexOf(uuidBuf);
    console.log(`\n--- Brundisium siege candidate at 0x${idx.toString(16)} in save_7 ---`);
    const off = idx - 1; // include the 01 flag byte
    console.log('full 73-byte block:');
    const block = s7.slice(off, off+73);
    let hexStr=''; for(let k=0;k<block.length;k++){hexStr+=block[k].toString(16).padStart(2,'0')+' '; if((k+1)%16===0)hexStr+='\n';}
    console.log(hexStr);
    console.log(`trailer u32 at +65 = ${s7.readUInt32LE(off+65)}`);
    // Show context after the block — should contain "Brundisium" or "roman general"
    console.log('Next 128 bytes (looking for settlement name):');
    let nextStr=''; for(let k=0;k<128 && off+73+k<s7.length;k++){nextStr+=s7[off+73+k].toString(16).padStart(2,'0')+' '; if((k+1)%16===0)nextStr+='\n';}
    console.log(nextStr);
    let asciiStr=''; for(let k=0;k<256 && off+73+k<s7.length;k++){const b=s7[off+73+k]; asciiStr+=(b>=32&&b<127)?String.fromCharCode(b):'.';}
    console.log('ASCII: '+asciiStr);
  }
}
