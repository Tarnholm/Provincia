// Pure diplomatic diff: T2 Start (peace, no trade) → T2 trade offer accepted.
// This is the clean signal for finding Spain↔Carthage relation bytes.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav'));

const t2startName = allFiles.find(f => f.includes('Spain') && f.includes('Turn 2 Start'));
const tradeName = allFiles.find(f => f.includes('Spain') && f.includes('trade'));

if (!t2startName) console.log('MISSING: T2 Start save');
if (!tradeName) console.log('MISSING: trade offer save');

if (t2startName && tradeName) {
  const A = fs.readFileSync(path.join(BASE, t2startName));
  const B = fs.readFileSync(path.join(BASE, tradeName));
  console.log('A:', t2startName, A.length, 'bytes');
  console.log('B:', tradeName, B.length, 'bytes');
  console.log('Δ:', B.length - A.length, 'bytes');

  // Compare carthage ASCII counts
  function countOf(buf, str) {
    let n = 0;
    let p = 0;
    const n2 = Buffer.from(str);
    while ((p = buf.indexOf(n2, p)) !== -1) { n++; p++; }
    return n;
  }
  console.log('\nFaction ASCII counts:');
  for (const f of ['carthage', 'spain', 'romans_julii', 'numidia', 'gauls', 'macedon', 'egypt']) {
    console.log('  ' + f.padEnd(14) + '  A=' + countOf(A, f) + '  B=' + countOf(B, f));
  }

  // Front/back diff alignment
  let frontDiff = -1;
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (A[i] !== B[i]) { frontDiff = i; break; }
  }
  let backDiff = -1;
  let ai = A.length - 1, bi = B.length - 1;
  while (ai >= 0 && bi >= 0) {
    if (A[ai] !== B[bi]) { backDiff = bi; break; }
    ai--; bi--;
  }
  console.log('\nFirst diff: 0x' + frontDiff.toString(16) + '  Last diff (in B): 0x' + backDiff.toString(16));

  // Find all positions where "carthage" appears in A but not at the same position in B
  // (these are the relation-flip records)
  console.log('\n=== Carthage ASCII occurrences side-by-side ===');
  const carthA = [];
  const carthB = [];
  let p = 0;
  while ((p = A.indexOf(Buffer.from('carthage'), p)) !== -1) { carthA.push(p); p++; }
  p = 0;
  while ((p = B.indexOf(Buffer.from('carthage'), p)) !== -1) { carthB.push(p); p++; }
  console.log('A carthage:', carthA.map(o => '0x' + o.toString(16)));
  console.log('B carthage:', carthB.map(o => '0x' + o.toString(16)));

  // Look for new context bytes around carthage instances that exist in B but not A
  // by comparing 32-byte windows
  console.log('\n=== Surrounding context of each "carthage" in B ===');
  for (let k = 0; k < carthB.length; k++) {
    const o = carthB[k];
    const slice = B.subarray(o - 16, o + 24);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  B [' + k + '] 0x' + o.toString(16) + ': ' + hex + '  ' + asc);
  }
}
