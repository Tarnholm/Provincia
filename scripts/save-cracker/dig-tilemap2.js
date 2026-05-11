// dig-tilemap2.js — pin the exact stride of the records in the "gap"
const fs = require('fs');
const path = process.argv[2] || 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(path);
const GAP_START = 0x633bb3, GAP_END = 0xf88637;

// Look for the recurring pattern: nonzero bytes at offsets +157,169,173,177,181,185,189,225,241,242,253 in each record
// From dig-tilemap1: 157->0x05, 169->0x0a, 173->0xc8, 177->0xc8, 181->0x02, 185->0x06, 189->0xc8, 225->0x03, 241->0x40 242->0x02 253->0xa6
// Use the 0x05 at +157 as anchor (rare value, distinctive).

const anchors = [];
for(let i = GAP_START; i < GAP_END; i++){
  // Look for the strong fingerprint: byte 0x05 followed by 0,0,0,0,0,0,0,0,0,0,0,0x0a (positions +157..+169)
  // I.e. byte 0x05 with the +12 byte being 0x0a
  if(buf[i] === 0x05 && buf[i+12] === 0x0a && buf[i+4] === 0 && buf[i+16] === 0 && buf[i+20] === 0xc8){
    anchors.push(i);
    if(anchors.length > 50) break;
  }
}
console.log('found', anchors.length, 'anchors with pattern 0x05 ... 0x0a (+12) ... 0xc8 (+20)');
console.log('first 20 deltas:');
for(let i=1;i<Math.min(anchors.length,20);i++){
  console.log('  '+(i-1)+'->'+i+': delta='+ (anchors[i] - anchors[i-1]) +' (0x'+(anchors[i]-anchors[i-1]).toString(16)+')');
}

// All anchors' relative offset within gap
console.log('\nfirst anchor at gap offset', anchors[0] - GAP_START);
console.log('  -> mod 267 =', (anchors[0] - GAP_START) % 267);

// Compute the total number of complete records
const stride = anchors[1] - anchors[0];
console.log('\nIf stride =', stride, ':');
const possRecCount = Math.floor((GAP_END - anchors[0]) / stride);
console.log('  possible records after first anchor:', possRecCount);
console.log('  data span used:', stride * possRecCount);
console.log('  leading gap (zeros before first):', anchors[0] - GAP_START);
console.log('  trailing gap:', GAP_END - (anchors[0] + stride * possRecCount));
console.log('  trailing gap interpretation: header=' + (anchors[0]-GAP_START) + ', payload=' + (stride*possRecCount) + ', trailer=' + (GAP_END - (anchors[0] + stride * possRecCount)));

// Check: does this work as a tile grid?
// If GAP region holds tile records, total = ? what's the count?
// Probably each "record" is one row of tiles. So 267 bytes per row, ~36644 rows? That doesn't match map height (~700).
// OR: each record is one tile (267 bytes) ... unlikely
// OR: it's one settlement / region — but there are only 200+ settlements

// Let's check if data is "all zeros for many rows then a record". Maybe one record per non-empty FOG cell.
// The most likely interpretation:
// Each record describes a SETTLEMENT or REGION-anchored tile data block.
// Let's check how many records have the FULL pattern fired
// (counter the matched anchors more carefully)
let total = 0;
for(let p = anchors[0]; p + 256 <= GAP_END; p += stride){
  if(buf[p] === 0x05 && buf[p+12] === 0x0a) total++;
}
console.log('\ntotal records matching first-byte pattern:', total);
