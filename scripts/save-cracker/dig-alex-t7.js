// Process new Turn 5/6/7 saves including the governor and merge actions.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

// Auto-discover by listing
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav'));
const WANT = ['Turn 5 Start', 'Turn 5 auto resolved battle', 'Turn 6 End', 'Turn 7 Start', 'Turn 7 New Governour', 'Turn 7 merge'];
const matched = [];
for (const want of WANT) {
  const found = allFiles.find(f => f.includes(want));
  if (found) matched.push([want.replace(/\s+/g, '_'), path.join(BASE, found)]);
  else console.log('MISSING pattern:', want);
}

function readCounters(buf) {
  return {
    year:   buf.readInt32LE(0x504),
    evtCtr: buf.readUInt32LE(0xefd),
  };
}

const bufs = {};
console.log('save'.padEnd(28) + '  size       year   evtCtr');
for (const [tag, p] of matched) {
  const buf = fs.readFileSync(p);
  bufs[tag] = buf;
  const c = readCounters(buf);
  console.log(tag.padEnd(28) + '  ' + buf.length.toString().padStart(8) +
              '  ' + c.year.toString().padStart(5) +
              '  ' + c.evtCtr.toString().padStart(8));
}

console.log('\n=== Pairwise End Turn / action deltas ===');
const pairs = [
  ['Turn_5_Start',                'Turn_5_auto_resolved_battle'],
  ['Turn_5_auto_resolved_battle', 'Turn_6_End'],
  ['Turn_6_End',                  'Turn_7_Start'],
  ['Turn_7_Start',                'Turn_7_New_Governour'],
  ['Turn_7_New_Governour',        'Turn_7_merge'],
];
for (const [aT, bT] of pairs) {
  if (!bufs[aT] || !bufs[bT]) continue;
  const a = bufs[aT], b = bufs[bT];
  const ca = readCounters(a), cb = readCounters(b);
  console.log('  ' + aT.padEnd(30) + ' → ' + bT.padEnd(30) +
              '  Δsize=' + (b.length - a.length).toString().padStart(7) +
              '  Δyear=' + (cb.year - ca.year).toString().padStart(2) +
              '  Δevt=' + (cb.evtCtr - ca.evtCtr).toString().padStart(5));
}

// Detailed: Turn 7 Start → New Governor (clean atomic player action)
const a = bufs.Turn_7_Start, b = bufs.Turn_7_New_Governour;
if (a && b) {
  console.log('\n=== Detailed: Turn 7 Start → New Governor in Sparta ===');
  console.log('Sizes:', a.length, '→', b.length, 'Δ=' + (b.length - a.length));
  // Find first/last diff
  let frontDiff = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) { frontDiff = i; break; }
  }
  let backDiff = -1;
  let ai = a.length - 1, bi = b.length - 1;
  while (ai >= 0 && bi >= 0) {
    if (a[ai] !== b[bi]) { backDiff = bi; break; }
    ai--; bi--;
  }
  console.log('First diff: 0x' + frontDiff.toString(16) + '  Last diff (in B): 0x' + backDiff.toString(16));
  console.log('Counter advance: ' + a.readUInt32LE(0xefd) + ' → ' + b.readUInt32LE(0xefd));

  // Quick byte mismatch count
  let mismatches = 0;
  const positions = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      mismatches++;
      if (positions.length < 30) positions.push(i);
    }
  }
  console.log('Total mismatches in equal-prefix:', mismatches);
  console.log('First 30 mismatch positions:', positions.map(o => '0x' + o.toString(16)).join(', '));
}

// New-governor is 7 bytes SMALLER. Strange — appointing a governor REMOVES content?
// Maybe it's because a TEMPORARY "no governor" record gets removed, replaced by
// a smaller "governor = X" reference.
