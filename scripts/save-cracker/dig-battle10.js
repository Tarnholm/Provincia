#!/usr/bin/env node
// Debug: find market cstring near 0x111c5.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_notdamagedturn1.sav'));
const B = fs.readFileSync(path.join(dir, 'save_damagedturn1.sav'));

// Find market cstring positions
const cstr = Buffer.from('market\0');
let pos = 0;
const positions = [];
while ((pos = A.indexOf(cstr, pos)) !== -1) {
  positions.push(pos);
  pos++;
}
console.log(`market positions (first 5): ${positions.slice(0, 5).map(p => '0x' + p.toString(16)).join(', ')}`);

// market[1] should be at 0x111c8 per the earlier search. Let me verify:
const p1 = positions[1];
console.log(`market[1] @ 0x${p1.toString(16)}`);
console.log(`bytes at p1..p1+50: ${A.slice(p1, p1+50).toString('hex')}`);
console.log(`damage byte should be at p1+0x111ec - p1 = ${0x111ec - p1}`);

// So the offset from "market" cstring start to damage byte is 0x111ec - 0x111c8 = 36
// (cstring "market" is 6 chars, null at +6, then we go past 30 more bytes)
const OFF = 0x111ec - p1;
console.log(`damage offset from "market" cstring start = ${OFF}`);

// Re-scan with that offset
console.log('\n=== Re-scan with correct offset (cstr_pos + 36) ===');
let diffs = 0;
for (const p of positions) {
  const dPos = p + OFF;
  if (dPos < A.length && A[dPos] !== B[dPos]) {
    diffs++;
    console.log(`  market @ 0x${p.toString(16)}: damage@0x${dPos.toString(16)}: A=${A[dPos]} B=${B[dPos]}`);
  }
}
console.log(`Total damage diffs in market sub-records: ${diffs}`);

// Now: what's the data structure within each market sub-record?
console.log('\n=== Hex dump of all market sub-records (first 40 bytes each) ===');
for (let i = 0; i < Math.min(positions.length, 8); i++) {
  const p = positions[i];
  console.log(`market[${i}] @ 0x${p.toString(16)}:`);
  console.log(`  A: ${A.slice(p, p + 60).toString('hex')}`);
}

// Also check default_set sub-records (those would be the entire settlement holder)
console.log('\n=== Hex dump of first 3 default_set sub-records ===');
const dscstr = Buffer.from('default_set\0');
let p2 = 0;
let cnt = 0;
while ((p2 = A.indexOf(dscstr, p2)) !== -1 && cnt < 3) {
  console.log(`default_set @ 0x${p2.toString(16)}: ${A.slice(p2, p2 + 80).toString('hex')}`);
  p2++;
  cnt++;
}
