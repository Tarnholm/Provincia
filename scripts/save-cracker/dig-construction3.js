#!/usr/bin/env node
// Find all settlement records (cb 00 00 00 marker at -21 from tax_byte) in both saves,
// match by settlement name (UTF-16LE), and report which ones differ between A and B.

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

// Find all "cb 00 00 00" marker positions; tax_byte at +21
function findSettlements(buf) {
  const settl = [];
  for (let i = 0; i + 21 + 2272 < buf.length; i++) {
    if (buf[i] === 0xcb && buf[i+1] === 0 && buf[i+2] === 0 && buf[i+3] === 0) {
      const taxByte = buf[i + 21];
      if (taxByte > 4) continue; // tax 0..4
      // Look for name marker 01 at +2269 from tax_byte
      const namePos = i + 21 + 2269;
      if (namePos + 4 >= buf.length) continue;
      if (buf[namePos] !== 0x01) continue;
      const nameLen = buf.readUInt16LE(namePos + 1);
      if (nameLen < 1 || nameLen > 100) continue;
      const nameStart = namePos + 3;
      if (nameStart + nameLen * 2 > buf.length) continue;
      let name = '';
      try {
        name = buf.slice(nameStart, nameStart + nameLen * 2).toString('utf16le');
      } catch (e) { continue; }
      // Check it's printable
      if (!/^[\x20-\x7e]+$/.test(name)) continue;
      settl.push({ pos: i, taxPos: i + 21, name, taxByte });
    }
  }
  return settl;
}

const sA = findSettlements(A);
const sB = findSettlements(B);
console.log(`Settlements A: ${sA.length}`);
console.log(`Settlements B: ${sB.length}`);

// Build maps
const mA = new Map();
const mB = new Map();
for (const s of sA) {
  if (!mA.has(s.name)) mA.set(s.name, []);
  mA.get(s.name).push(s);
}
for (const s of sB) {
  if (!mB.has(s.name)) mB.set(s.name, []);
  mB.get(s.name).push(s);
}

console.log(`\nUnique settlement names A: ${mA.size}, B: ${mB.size}`);

// For each settlement in A that exists in B, compute a record-size estimate (3000 bytes)
// and diff the byte ranges
const RECORD_SIZE = 3000; // ~3000 bytes per record; we'll diff this much past taxPos
const HEAD_PRE = 25; // bytes before tax byte

let diffSummary = [];
for (const [name, listA] of mA) {
  const listB = mB.get(name);
  if (!listB || listB.length !== listA.length) continue;
  // Pair them up by index (assume order)
  for (let i = 0; i < listA.length; i++) {
    const aTax = listA[i].taxPos;
    const bTax = listB[i].taxPos;
    const aStart = aTax - HEAD_PRE;
    const bStart = bTax - HEAD_PRE;
    // Count differing bytes in next RECORD_SIZE bytes
    let diffCount = 0;
    let firstDiff = -1;
    const diffOffsets = [];
    for (let j = 0; j < RECORD_SIZE + HEAD_PRE; j++) {
      if (aStart + j >= A.length || bStart + j >= B.length) break;
      if (A[aStart + j] !== B[bStart + j]) {
        diffCount++;
        diffOffsets.push(j);
        if (firstDiff < 0) firstDiff = j;
      }
    }
    if (diffCount > 0) {
      diffSummary.push({ name, instance: i, aTax, bTax, diffCount, firstDiff, diffOffsets: diffOffsets.slice(0, 20) });
    }
  }
}

diffSummary.sort((x, y) => y.diffCount - x.diffCount);

console.log(`\nSettlements with diffs (top 30 by diff count):`);
for (const d of diffSummary.slice(0, 30)) {
  console.log(`  ${d.name} #${d.instance}: aTax=0x${d.aTax.toString(16)} bTax=0x${d.bTax.toString(16)} diffs=${d.diffCount} first@${d.firstDiff}`);
  console.log(`    diff offsets (relative to taxPos-${HEAD_PRE}): ${d.diffOffsets.join(',')}`);
}
console.log(`\nSettlements with zero diffs: ${[...mA.keys()].length - diffSummary.length}`);
