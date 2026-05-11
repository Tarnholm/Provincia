#!/usr/bin/env node
// Compare same building chain by name (core_building) in A and B Pella.
// Look at the INSERT block that's between the prior header bytes and core_building's start.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

const aPellaName = 0x10d8c;
const bPellaName = 0x10d8c;

// Find ALL "core_building" instances and their preceding bytes
const cstr = Buffer.from('core_building\0');

function findCoreBuildings(buf) {
  const out = [];
  let pos = 0;
  while ((pos = buf.indexOf(cstr, pos)) !== -1) {
    out.push(pos);
    pos += 1;
  }
  return out;
}

const aCb = findCoreBuildings(A);
const bCb = findCoreBuildings(B);
console.log(`A core_building hits: ${aCb.length}`);
console.log(`B core_building hits: ${bCb.length}`);

// Find the first one inside Pella's window (~aPellaName + 90..200)
const aPellaCb = aCb.find(p => p > aPellaName && p < aPellaName + 500);
const bPellaCb = bCb.find(p => p > bPellaName && p < bPellaName + 500);
console.log(`\nPella's core_building in A: 0x${aPellaCb.toString(16)} (rel +${aPellaCb - aPellaName})`);
console.log(`Pella's core_building in B: 0x${bPellaCb.toString(16)} (rel +${bPellaCb - bPellaName})`);

// Each entry has 14-byte header before: [u32 self-ptr][u32 self-ptr][u16 nameLen]
// Or the prior session 3 says [u32 self-ptr][u16 nameLen][ASCIIZ]
// The hit position is at the start of "core_building" cstring; nameLen u16 sits at hit-2, self-ptr at hit-6.
console.log(`\nA: bytes preceding Pella's core_building (-32..0):`);
console.log(`  ${A.slice(aPellaCb - 32, aPellaCb).toString('hex')}`);
console.log(`B: bytes preceding Pella's core_building (-32..0):`);
console.log(`  ${B.slice(bPellaCb - 32, bPellaCb).toString('hex')}`);

// Now look BACKWARD to find the previous sub-record / settlement-record header
// In A, core_building is at +91 from name. Subtract back ~80 bytes to find the prior boundary.
console.log(`\nA bytes from aPellaName..core_building start:`);
const aBytes = A.slice(aPellaName + 50, aPellaCb);
console.log(`  len=${aBytes.length}: ${aBytes.toString('hex')}`);

console.log(`\nB bytes from bPellaName..core_building start:`);
const bBytes = B.slice(bPellaName + 50, bPellaCb);
console.log(`  len=${bBytes.length}: ${bBytes.toString('hex')}`);

// THE INSERT
console.log(`\n=== B insert (extra bytes B has that A doesn't have) ===`);
console.log(`A pre-core_building length: ${aBytes.length}`);
console.log(`B pre-core_building length: ${bBytes.length}`);
console.log(`Δ: ${bBytes.length - aBytes.length} bytes inserted`);

// Try to align them — find longest common suffix
let commonSuffix = 0;
while (commonSuffix < aBytes.length && commonSuffix < bBytes.length &&
       aBytes[aBytes.length - 1 - commonSuffix] === bBytes[bBytes.length - 1 - commonSuffix]) {
  commonSuffix++;
}
console.log(`Common suffix: ${commonSuffix} bytes match at the tail`);

// What's the prefix that matches
let commonPrefix = 0;
while (commonPrefix < aBytes.length && commonPrefix < bBytes.length &&
       aBytes[commonPrefix] === bBytes[commonPrefix]) {
  commonPrefix++;
}
console.log(`Common prefix: ${commonPrefix} bytes match at the head`);

// The middle is the diff
console.log(`\nA middle (after common prefix, before common suffix):`);
console.log(`  ${aBytes.slice(commonPrefix, aBytes.length - commonSuffix).toString('hex')}`);
console.log(`B middle (after common prefix, before common suffix):`);
console.log(`  ${bBytes.slice(commonPrefix, bBytes.length - commonSuffix).toString('hex')}`);
console.log(`\nB extra middle bytes (size: ${bBytes.length - aBytes.length}):`);
const aMid = aBytes.slice(commonPrefix, aBytes.length - commonSuffix);
const bMid = bBytes.slice(commonPrefix, bBytes.length - commonSuffix);
console.log(`  aMid len=${aMid.length}: ${aMid.toString('hex')}`);
console.log(`  bMid len=${bMid.length}: ${bMid.toString('hex')}`);
