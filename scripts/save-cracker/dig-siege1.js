// dig-siege1.js
// Find the +73-byte structure introduced in save_6.1 → save_7.1 (Brundisium
// siege began) and removed in save_8.1 → save_9.1 (Tarentum siege stopped).
//
// Approach:
//   1. Anchor pairs (save6,save7) and (save8,save9) using head/tail
//      common prefix/suffix to find the byte-range of insertion / deletion.
//   2. Verify the insert size = +73 in pair 1 and -73 in pair 2.
//   3. Dump the +73-byte payload from save_7 (Brundisium siege start) and
//      the -73-byte payload from save_8 (Tarentum siege start) to see if
//      they share a schema.

const fs = require('fs');
const path = require('path');

const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const files = ['save_6.1.sav','save_7.1.sav','save_8.1.sav','save_9.1.sav'];
const bufs = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(SAVES_DIR,f))]));

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}
function commonSuffix(a, b, startA = 0, startB = 0) {
  let i = 0;
  while (i < a.length - startA && i < b.length - startB && a[a.length-1-i] === b[b.length-1-i]) i++;
  return i;
}

function diffWindow(A, B, label) {
  console.log(`\n=== ${label}  Aln=${A.length} Bln=${B.length} netΔ=${B.length-A.length} ===`);
  const pre = commonPrefix(A, B);
  const suf = commonSuffix(A, B);
  // Region in A: [pre .. A.length - suf)
  // Region in B: [pre .. B.length - suf)
  const aLen = A.length - suf - pre;
  const bLen = B.length - suf - pre;
  console.log(`  commonPrefix=0x${pre.toString(16)} commonSuffix=0x${suf.toString(16)}`);
  console.log(`  diff region in A: 0x${pre.toString(16)} .. 0x${(A.length-suf).toString(16)}  (${aLen}B)`);
  console.log(`  diff region in B: 0x${pre.toString(16)} .. 0x${(B.length-suf).toString(16)}  (${bLen}B)`);
  return { pre, suf, aLen, bLen };
}

// Pair 1: save_6 → save_7  (siege of Brundisium begins, net +73B)
const r67 = diffWindow(bufs['save_6.1.sav'], bufs['save_7.1.sav'], 'save_6 → save_7 (Brundisium siege START)');
// Pair 2: save_8 → save_9  (siege of Tarentum stops, net -73B)
const r89 = diffWindow(bufs['save_8.1.sav'], bufs['save_9.1.sav'], 'save_8 → save_9 (Tarentum siege STOP)');

// Show the bytes in the diff region for both pairs
function hex(buf, off, n=128) {
  const s=[];
  for (let i = 0; i < n; i++) {
    s.push(buf[off+i].toString(16).padStart(2,'0'));
    if ((i+1)%16===0) s.push('\n');
  }
  return s.join(' ');
}

function ascii(buf, off, n=128) {
  let s='';
  for (let i=0;i<n;i++){
    const b=buf[off+i];
    s += (b>=32 && b<127) ? String.fromCharCode(b) : '.';
  }
  return s;
}

console.log('\n--- Pair 1 (save_6 → save_7): inserted/changed bytes ---');
// If pure insert, A has aLen bytes that DIFFER from the first aLen of B's diff region.
// Show the first 256 bytes of both
const off67 = r67.pre;
console.log(`  A=save_6 bytes around 0x${off67.toString(16)}:`);
console.log(hex(bufs['save_6.1.sav'], off67, 256));
console.log('  ASCII:', ascii(bufs['save_6.1.sav'], off67, 256));
console.log(`  B=save_7 bytes around 0x${off67.toString(16)}:`);
console.log(hex(bufs['save_7.1.sav'], off67, 256));
console.log('  ASCII:', ascii(bufs['save_7.1.sav'], off67, 256));

console.log('\n--- Pair 2 (save_8 → save_9): inserted/changed bytes ---');
const off89 = r89.pre;
console.log(`  A=save_8 bytes around 0x${off89.toString(16)}:`);
console.log(hex(bufs['save_8.1.sav'], off89, 256));
console.log('  ASCII:', ascii(bufs['save_8.1.sav'], off89, 256));
console.log(`  B=save_9 bytes around 0x${off89.toString(16)}:`);
console.log(hex(bufs['save_9.1.sav'], off89, 256));
console.log('  ASCII:', ascii(bufs['save_9.1.sav'], off89, 256));
