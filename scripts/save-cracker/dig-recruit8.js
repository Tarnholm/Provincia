// Roma's settlement record is in the range 0x1514100..0x151c000 (~32 KB).
// Compare save_2.2 and save_3.2 BYTE BY BYTE in this region — by aligning
// at the first Roma entry start.

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_2.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_3.2.sav'));

// save_2.2 first Roma entry: 0x1514174
// save_3.2 first Roma entry: 0x1514162
// shift = -18 bytes (matches net delta)
const aStart = 0x1514174;
const bStart = 0x1514162;
const aEnd = 0x151c000;
const bEnd = aEnd + (bStart - aStart);
// In the recruit region, both files should be byte-identical AFTER aligning by -18.

console.log(`A region: [0x${aStart.toString(16)} .. 0x${aEnd.toString(16)}) = ${aEnd-aStart} B`);
console.log(`B region: [0x${bStart.toString(16)} .. 0x${bEnd.toString(16)}) = ${bEnd-bStart} B`);

// Show where they differ (after shift)
const span = aEnd - aStart;
const diffs = [];
for (let i = 0; i < span; i++) {
  if (A[aStart + i] !== B[bStart + i]) diffs.push(i);
}
console.log(`After shift, ${diffs.length} byte diffs in the Roma region`);
if (diffs.length < 500) {
  // group consecutive
  const runs = [];
  let r = null;
  for (const d of diffs) {
    if (r && d <= r.last + 4) r.last = d;
    else { if (r) runs.push(r); r = { first: d, last: d }; }
  }
  if (r) runs.push(r);
  console.log(`${runs.length} run-clusters:`);
  for (const r of runs) {
    const aOff = aStart + r.first;
    const bOff = bStart + r.first;
    const len = r.last - r.first + 1;
    const aBytes = A.slice(aOff, aOff + len + 8).toString('hex');
    const bBytes = B.slice(bOff, bOff + len + 8).toString('hex');
    console.log(`  rel +0x${r.first.toString(16)}  A=0x${aOff.toString(16)}  B=0x${bOff.toString(16)}  len=${len}`);
    console.log(`    A: ${aBytes}`);
    console.log(`    B: ${bBytes}`);
  }
}

// Now where does the −18 byte size delta show up? It must be EITHER:
//  (a) inside Roma (a queue entry was removed)
//  (b) elsewhere (e.g. de-queued wall + added levies recruit elsewhere)
// We aligned by Roma's first entry — if the shift stays at -18 throughout
// then the −18 happened BEFORE Roma. If shift changes inside Roma, it's there.
console.log('\nLooking for the −18 offset inside Roma region...');
// We'll re-anchor at each known Roma string within both files and report
// (A_off - B_off).
const ROMA_SIG = Buffer.from([0x00, 0x04, 0, 0x52, 0, 0x6f, 0, 0x6d, 0, 0x61, 0]);
const aHits = [];
let p = 0x1500000;
while ((p = A.indexOf(ROMA_SIG, p)) !== -1) { aHits.push(p); p++; if (p > 0x1530000) break; }
const bHits = [];
p = 0x1500000;
while ((p = B.indexOf(ROMA_SIG, p)) !== -1) { bHits.push(p); p++; if (p > 0x1530000) break; }
console.log(`A Roma hits: ${aHits.length}; B Roma hits: ${bHits.length}`);
for (let i = 0; i < Math.min(aHits.length, bHits.length); i++) {
  console.log(`  ${i}: A=0x${aHits[i].toString(16)}  B=0x${bHits[i].toString(16)}  Δ=${aHits[i]-bHits[i]}`);
}
