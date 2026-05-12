// dig-armyboard3.js — characterize army-board precise schema.
// We have a +138B net delta. The big insert is at 0x01504d84 (44B), with sub-pieces.
// Decode each insert as u32 array, and look for the per-unit list.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// The 44B ins at 0x01504d84 (decoded above) appears to be a chunk that breaks down as:
// 0x01504d84  +44B:  body shifts
// We saw it's actually multiple sub-events. Let's redo a precise diff that catches both insertions AND substitutions.

// Re-run a fine diff focused on the [0x1504d70..0x1535900] region
const LO = 0x01504d00;
const HI = 0x01535980;
const wA = A.subarray(LO, HI);
const wB = B.subarray(LO, HI + 200);  // B is longer

let pa = 0, pb = 0;
const events = [];
while (pa < wA.length && pb < wB.length) {
  if (wA[pa] === wB[pb]) {
    pa++; pb++;
    continue;
  }
  // Insertion in B
  let foundIns = -1;
  for (let k = 1; k <= 256 && pb + k < wB.length; k++) {
    if (wA[pa] === wB[pb + k]) {
      let m = 0;
      while (m < 64 && pa + m < wA.length && pb + k + m < wB.length && wA[pa + m] === wB[pb + k + m]) m++;
      if (m >= 32) { foundIns = k; break; }
    }
  }
  let foundDel = -1;
  for (let k = 1; k <= 256 && pa + k < wA.length; k++) {
    if (wA[pa + k] === wB[pb]) {
      let m = 0;
      while (m < 64 && pa + k + m < wA.length && pb + m < wB.length && wA[pa + k + m] === wB[pb + m]) m++;
      if (m >= 32) { foundDel = k; break; }
    }
  }
  if (foundIns >= 0 && (foundDel < 0 || foundIns <= foundDel)) {
    events.push({ type: 'ins', aOff: pa + LO, bOff: pb + LO, len: foundIns, bytes: wB.subarray(pb, pb + foundIns) });
    pb += foundIns;
  } else if (foundDel >= 0) {
    events.push({ type: 'del', aOff: pa + LO, bOff: pb + LO, len: foundDel, bytes: wA.subarray(pa, pa + foundDel) });
    pa += foundDel;
  } else {
    events.push({ type: 'sub', aOff: pa + LO, bOff: pb + LO, a: wA[pa], b: wB[pb] });
    pa++; pb++;
  }
  if (events.length > 1000) break;
}

console.log(`Events: ${events.length}`);
let totalIns = 0, totalDel = 0, nSub = 0;
for (const e of events) {
  if (e.type === 'ins') totalIns += e.len;
  else if (e.type === 'del') totalDel += e.len;
  else nSub++;
}
console.log(`Total ins=${totalIns} del=${totalDel} sub=${nSub}  net=${totalIns - totalDel}`);

// Show all ≥4B
for (const e of events) {
  if (e.type === 'sub') continue;
  if (!e.len || e.len < 4) continue;
  console.log(`  ${e.type} A=${hex(e.aOff)} B=${hex(e.bOff)} len=${e.len}`);
  console.log(`    bytes: ${e.bytes.toString('hex')}`);
  // Decode as u32 array
  for (let i = 0; i < Math.min(e.len, 64); i += 4) {
    if (i + 4 > e.len) break;
    const u32 = e.bytes.readUInt32LE(i);
    console.log(`      u32 @ +${i.toString(16).padStart(2,'0')}: ${u32}  (0x${u32.toString(16).padStart(8,'0')})`);
  }
}

console.log('\nAll subs:');
for (const e of events) {
  if (e.type === 'sub') {
    console.log(`  ${hex(e.aOff)}: ${e.a.toString(16).padStart(2,'0')} → ${e.b.toString(16).padStart(2,'0')}`);
  }
}
