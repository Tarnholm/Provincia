// dig-board6.js — proper 2-pointer aligned diff on the WHOLE save_6.2 vs save_7.2 file
// to identify the actual structural inserts/deletes (which must balance to net 0).

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');
const N = A.length;

// 2-pointer aligned diff with 256-byte lookahead, 32-byte verification
let pa = 0, pb = 0;
const events = [];
let nSub = 0;
while (pa < A.length && pb < B.length) {
  if (A[pa] === B[pb]) {
    pa++; pb++;
    continue;
  }
  // Try insertion in B
  let foundIns = -1;
  const limit = 1024;
  for (let k = 1; k <= limit && pb + k < B.length; k++) {
    if (A[pa] === B[pb + k]) {
      let m = 0;
      while (m < 128 && pa + m < A.length && pb + k + m < B.length && A[pa + m] === B[pb + k + m]) m++;
      if (m >= 64) {
        foundIns = k;
        break;
      }
    }
  }
  let foundDel = -1;
  for (let k = 1; k <= limit && pa + k < A.length; k++) {
    if (A[pa + k] === B[pb]) {
      let m = 0;
      while (m < 128 && pa + k + m < A.length && pb + m < B.length && A[pa + k + m] === B[pb + m]) m++;
      if (m >= 64) {
        foundDel = k;
        break;
      }
    }
  }
  if (foundIns >= 0 && (foundDel < 0 || foundIns <= foundDel)) {
    events.push({ type: 'ins', aOff: pa, bOff: pb, len: foundIns });
    pb += foundIns;
  } else if (foundDel >= 0) {
    events.push({ type: 'del', aOff: pa, bOff: pb, len: foundDel });
    pa += foundDel;
  } else {
    nSub++;
    pa++; pb++;
  }
  if (events.length % 1000 === 0 && events.length > 0) {
    console.log(`... ${events.length} events, pa=${hex(pa)} pb=${hex(pb)}`);
  }
}

console.log(`\nEvents: ${events.length}, subs: ${nSub}`);
let totalIns = 0, totalDel = 0;
for (const e of events) {
  if (e.type === 'ins') totalIns += e.len;
  else if (e.type === 'del') totalDel += e.len;
}
console.log(`Total ins=${totalIns}, del=${totalDel}, net=${totalIns - totalDel}`);

// Show all big events
console.log('\nAll events ≥ 16 bytes:');
for (const e of events) {
  if (e.len < 16) continue;
  console.log(`  ${e.type} A=${hex(e.aOff)} B=${hex(e.bOff)} len=${e.len}`);
  // Dump 64 bytes of the inserted/deleted content
  if (e.type === 'ins') {
    const slice = B.subarray(e.bOff, e.bOff + Math.min(e.len, 96));
    console.log(`    bytes: ${slice.toString('hex')}`);
  } else {
    const slice = A.subarray(e.aOff, e.aOff + Math.min(e.len, 96));
    console.log(`    bytes: ${slice.toString('hex')}`);
  }
}

// Save full events list
fs.writeFileSync(path.join(__dirname, 'out-board-events.json'),
  JSON.stringify(events.map(e => ({ type: e.type, aOff: e.aOff, bOff: e.bOff, len: e.len })), null, 1));
console.log('Wrote out-board-events.json');
