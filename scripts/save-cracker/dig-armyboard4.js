// dig-armyboard4.js — full file aligned 2-pointer diff for army-board (+138B)

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

let pa = 0, pb = 0;
const events = [];
let nSub = 0;
while (pa < A.length && pb < B.length) {
  if (A[pa] === B[pb]) {
    pa++; pb++;
    continue;
  }
  let foundIns = -1;
  for (let k = 1; k <= 1024 && pb + k < B.length; k++) {
    if (A[pa] === B[pb + k]) {
      let m = 0;
      while (m < 128 && pa + m < A.length && pb + k + m < B.length && A[pa + m] === B[pb + k + m]) m++;
      if (m >= 64) { foundIns = k; break; }
    }
  }
  let foundDel = -1;
  for (let k = 1; k <= 1024 && pa + k < A.length; k++) {
    if (A[pa + k] === B[pb]) {
      let m = 0;
      while (m < 128 && pa + k + m < A.length && pb + m < B.length && A[pa + k + m] === B[pb + m]) m++;
      if (m >= 64) { foundDel = k; break; }
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
}

console.log(`Events: ${events.length}, subs: ${nSub}`);
let totalIns = 0, totalDel = 0;
for (const e of events) {
  if (e.type === 'ins') totalIns += e.len;
  else if (e.type === 'del') totalDel += e.len;
}
console.log(`Total ins=${totalIns} del=${totalDel} net=${totalIns - totalDel}`);

// All structural events ≥4B
console.log('\nAll structural events ≥ 4B:');
for (const e of events) {
  if (e.len < 4) continue;
  console.log(`  ${e.type} A=${hex(e.aOff)} B=${hex(e.bOff)} len=${e.len}`);
  if (e.type === 'ins') {
    const slice = B.subarray(e.bOff, e.bOff + Math.min(e.len, 128));
    console.log(`    bytes: ${slice.toString('hex')}`);
  } else {
    const slice = A.subarray(e.aOff, e.aOff + Math.min(e.len, 128));
    console.log(`    bytes: ${slice.toString('hex')}`);
  }
}

fs.writeFileSync(path.join(__dirname, 'out-armyboard-events.json'),
  JSON.stringify(events.map(e => ({ type: e.type, aOff: e.aOff, bOff: e.bOff, len: e.len })), null, 1));
