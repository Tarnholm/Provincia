// dig-armyboard1.js
// Army-boards-ship diff: save_7.2 (34,690,796) vs save_8.2 (34,690,934)  +138B
// Find the inserted block.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));

console.log(`A size: ${A.length}  B size: ${B.length}  delta=${B.length - A.length}`);

// 2-pointer aligned diff with lookahead to find insertion point
const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// Find divergence start
let i = 0;
const minN = Math.min(A.length, B.length);
while (i < minN && A[i] === B[i]) i++;
console.log(`first divergence at A=${hex(i)} B=${hex(i)}`);

// From end: find tail match
let aEnd = A.length, bEnd = B.length;
while (aEnd > i && bEnd > i && A[aEnd - 1] === B[bEnd - 1]) {
  aEnd--; bEnd--;
}
console.log(`first divergence from end: A=${hex(aEnd)} B=${hex(bEnd)}  (B - A = ${bEnd - aEnd})`);
console.log(`Differing window: A[${hex(i)}..${hex(aEnd)}] (${aEnd - i}B) vs B[${hex(i)}..${hex(bEnd)}] (${bEnd - i}B)`);

// In the differing window, try a fine alignment with a windowed diff
const winA = A.subarray(i, aEnd);
const winB = B.subarray(i, bEnd);
console.log(`window A len = ${winA.length}, window B len = ${winB.length}`);

// Print first 256 bytes of each window
console.log('\nFirst 256 bytes of differing window — A:');
console.log(winA.subarray(0, Math.min(256, winA.length)).toString('hex'));
console.log('First 256 bytes of differing window — B:');
console.log(winB.subarray(0, Math.min(256, winB.length)).toString('hex'));

// If only one insertion, look for a "fork" point: where B's content is offset by 138 forward
const DELTA = 138;
let forkA = -1;
for (let a = 0; a < Math.min(winA.length, winB.length - DELTA); a++) {
  if (winA[a] !== winB[a]) continue; // skip equal prefix
  if (winA[a] === winB[a + DELTA]) {
    // Check 16-byte alignment after a
    let m = 0;
    while (m < 32 && a + m < winA.length && winA[a + m] === winB[a + m + DELTA]) m++;
    if (m >= 16) {
      forkA = a;
      console.log(`Possible insertion point at window-rel ${hex(a)} (file ${hex(i + a)}): A[+0..+${m}] matches B[+${DELTA}..]`);
      break;
    }
  }
}

// More carefully: locate the exact insertion boundary by full 2-pointer alignment
console.log('\nFull 2-pointer diff with insertion mode:');
let pa = 0, pb = 0;
const events = [];
while (pa < winA.length || pb < winB.length) {
  if (pa < winA.length && pb < winB.length && winA[pa] === winB[pb]) {
    pa++; pb++;
    continue;
  }
  // Try insertion (B has extra)
  let foundIns = -1;
  for (let k = 1; k <= 256 && pb + k < winB.length; k++) {
    if (winA[pa] === winB[pb + k]) {
      // Verify 32+ matching bytes after
      let m = 0;
      while (m < 32 && pa + m < winA.length && pb + k + m < winB.length && winA[pa + m] === winB[pb + k + m]) m++;
      if (m >= 16) {
        foundIns = k;
        break;
      }
    }
  }
  // Try deletion (A has extra)
  let foundDel = -1;
  for (let k = 1; k <= 256 && pa + k < winA.length; k++) {
    if (winA[pa + k] === winB[pb]) {
      let m = 0;
      while (m < 32 && pa + k + m < winA.length && pb + m < winB.length && winA[pa + k + m] === winB[pb + m]) m++;
      if (m >= 16) {
        foundDel = k;
        break;
      }
    }
  }
  if (foundIns >= 0 && (foundDel < 0 || foundIns <= foundDel)) {
    events.push({ type: 'ins', aOff: pa + i, bOff: pb + i, len: foundIns, bytes: winB.subarray(pb, pb + foundIns).toString('hex') });
    pb += foundIns;
  } else if (foundDel >= 0) {
    events.push({ type: 'del', aOff: pa + i, bOff: pb + i, len: foundDel, bytes: winA.subarray(pa, pa + foundDel).toString('hex') });
    pa += foundDel;
  } else {
    // single-byte sub
    events.push({ type: 'sub', aOff: pa + i, bOff: pb + i, a: winA[pa], b: winB[pb] });
    pa++; pb++;
  }
  if (events.length > 500) break;
}

console.log(`\nEvents: ${events.length}`);
let netIns = 0, netDel = 0, netSub = 0;
for (const e of events) {
  if (e.type === 'ins') netIns += e.len;
  else if (e.type === 'del') netDel += e.len;
  else netSub++;
}
console.log(`Net: ins=${netIns}B  del=${netDel}B  sub=${netSub}  netDelta=${netIns - netDel}`);

// Show all big inserts/dels
console.log('\nLarge events (≥4B):');
for (const e of events) {
  if (e.type === 'sub') continue;
  if (e.len < 4) continue;
  console.log(`  ${e.type} at A=${hex(e.aOff)} B=${hex(e.bOff)} len=${e.len}`);
  if (e.bytes && e.bytes.length <= 400) {
    console.log(`    bytes: ${e.bytes}`);
  }
}

// Show all subs
console.log('\nAll single-byte substitutions:');
for (const e of events) {
  if (e.type !== 'sub') continue;
  console.log(`  sub at A=${hex(e.aOff)}  ${e.a.toString(16).padStart(2, '0')} → ${e.b.toString(16).padStart(2, '0')}`);
}
