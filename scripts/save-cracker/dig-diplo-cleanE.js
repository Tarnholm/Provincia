// Session 32 step E: compute (row, col) of the two flipped records.
// Need to know matrix start. Try the FIRST record found at 0xf8fd2 (enum offset).
// flip1: enum at 0x103286, so index = (0x103286 - 0xf8fd2) / 267 = ?
// flip2: enum at 0xa775de, so index = (0xa775de - 0xf8fd2) / 267 = ?

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));

const stride = 267;
const enum0 = 0xf8fd2;   // first record's enum
const flip1Enum = 0x103286;
const flip2Enum = 0xa775de;

console.log(`First enum: 0x${enum0.toString(16)}`);
console.log(`Flip1 enum: 0x${flip1Enum.toString(16)}`);
console.log(`Flip2 enum: 0xa775de`);

const off1 = flip1Enum - enum0;
const off2 = flip2Enum - enum0;
console.log(`Flip1 byte offset from first record: ${off1} (0x${off1.toString(16)})`);
console.log(`Flip2 byte offset from first record: ${off2} (0x${off2.toString(16)})`);
console.log(`Flip1 index (offset/267): ${off1/stride} = ${off1/stride|0} R ${off1 % stride}`);
console.log(`Flip2 index (offset/267): ${off2/stride} = ${off2/stride|0} R ${off2 % stride}`);

// If both flips line up with stride 267 (remainder 0), they're records in a packed array.
// If remainder != 0, the records are not in the same array starting at enum0.

// Note: hits[0] == 0xf8fde (sig start). The matrix might not actually start at 0xf8fd2.
// What if there are records before 0xf8fd2? Walk back in 267-byte steps to find the actual start.

console.log(`\nWalking back from 0xf8fd2 by 267 to find matrix start...`);
let cur = enum0;
let count = 0;
while (cur >= 0) {
  const enumVal = a.readUInt32LE(cur);
  // Show a quick fingerprint: enum + 4 bytes at +12 (would be 0x0a for default sig).
  const sigByte = a[cur + 12];
  console.log(`  off=0x${cur.toString(16)} enum=${enumVal} +12byte=0x${sigByte.toString(16)}`);
  if (count > 30) break;
  cur -= stride;
  count++;
}

// Walk forward by 267 to verify alignment.
console.log(`\nWalking forward from 0xf8fd2 by 267 to confirm alignment...`);
cur = enum0;
count = 0;
const enumDist = {};
while (cur < a.length && count < 60000) {
  const enumVal = a.readUInt32LE(cur);
  enumDist[enumVal] = (enumDist[enumVal] || 0) + 1;
  cur += stride;
  count++;
}
console.log(`After ${count} steps, enum value histogram:`);
const top = Object.entries(enumDist).sort((x, y) => y[1] - x[1]).slice(0, 20);
for (const [v, c] of top) console.log(`  enum=${v}: ${c}`);
