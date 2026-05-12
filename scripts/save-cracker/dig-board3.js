// dig-board3.js — find ASCII strings in the affected region 0x1500000+
// and try to identify what kind of data is there.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// Sample ASCII strings ≥ 8 chars in the 0x1500000..0x1700000 region (in A)
console.log('=== ASCII strings ≥6 chars in 0x1500000..0x1700000 (from A=save_6.2) ===');
function scanAscii(buf, lo, hi, minLen = 6, limit = 50) {
  const out = [];
  let runStart = -1;
  for (let i = lo; i < hi; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1 && i - runStart >= minLen) {
        out.push({ off: runStart, str: buf.subarray(runStart, i).toString('ascii') });
        if (out.length >= limit) return out;
      }
      runStart = -1;
    }
  }
  return out;
}
const strs = scanAscii(A, 0x1500000, 0x1700000, 6, 100);
for (const s of strs.slice(0, 60)) {
  console.log(`  ${hex(s.off)}: "${s.str}"`);
}

// Find first divergence point in the 0x1500000+ region precisely
console.log('\n=== Where does the 0x1500000+ divergence start? ===');
for (let i = 0x1500000; i < 0x1600000; i++) {
  if (A[i] !== B[i]) {
    console.log(`First diff in 0x1500000+: ${hex(i)}`);
    // Dump 128 bytes around
    const lo = Math.max(0x1500000, i - 32);
    const hi = Math.min(A.length, i + 128);
    console.log(`  A: ${A.subarray(lo, hi).toString('hex')}`);
    console.log(`  B: ${B.subarray(lo, hi).toString('hex')}`);
    break;
  }
}

// Find LAST byte in the 0x1500000+ region that's still equal (before divergence cascade)
let lastEq = -1;
for (let i = 0x1500000; i < 0x1700000; i++) {
  if (A[i] === B[i]) lastEq = i;
}
console.log(`Last equal byte in 0x1500000..0x1700000: ${hex(lastEq)}`);

// Check if the data is a shifted version (B is A shifted by some delta)
// Test: does B[X] == A[X - 4] for many bytes?
console.log('\n=== Shift detection ===');
for (const shift of [4, 8, 12, 16, 20, 24, 32, 35, 138, -4, -8, -12, -16]) {
  let matches = 0;
  const sampleStart = 0x1535b00;
  const sampleEnd = 0x1535d00;
  for (let i = sampleStart; i < sampleEnd; i++) {
    if (i - shift >= 0 && i - shift < A.length && B[i] === A[i - shift]) matches++;
  }
  console.log(`  shift ${shift}: ${matches}/${sampleEnd - sampleStart} matches`);
}

// Check if a single point of insert/delete and the rest shifts
// Aligned 2-pointer diff in this region
console.log('\n=== 2-pointer aligned diff in [0x1500000..0x1700000] ===');
const lo = 0x1500000;
const hi = 0x1700000;
const winA = A.subarray(lo, hi);
const winB = B.subarray(lo, hi);

let pa = 0, pb = 0;
const events = [];
let maxEvents = 100;
while ((pa < winA.length || pb < winB.length) && events.length < maxEvents) {
  if (pa < winA.length && pb < winB.length && winA[pa] === winB[pb]) {
    pa++; pb++;
    continue;
  }
  // Try insertion in B
  let foundIns = -1;
  const limit = 256;
  for (let k = 1; k <= limit && pb + k < winB.length; k++) {
    if (winA[pa] === winB[pb + k]) {
      let m = 0;
      while (m < 64 && pa + m < winA.length && pb + k + m < winB.length && winA[pa + m] === winB[pb + k + m]) m++;
      if (m >= 32) {
        foundIns = k;
        break;
      }
    }
  }
  let foundDel = -1;
  for (let k = 1; k <= limit && pa + k < winA.length; k++) {
    if (winA[pa + k] === winB[pb]) {
      let m = 0;
      while (m < 64 && pa + k + m < winA.length && pb + m < winB.length && winA[pa + k + m] === winB[pb + m]) m++;
      if (m >= 32) {
        foundDel = k;
        break;
      }
    }
  }
  if (foundIns >= 0 && (foundDel < 0 || foundIns <= foundDel)) {
    events.push({ type: 'ins', aOff: lo + pa, bOff: lo + pb, len: foundIns });
    pb += foundIns;
  } else if (foundDel >= 0) {
    events.push({ type: 'del', aOff: lo + pa, bOff: lo + pb, len: foundDel });
    pa += foundDel;
  } else {
    events.push({ type: 'sub', aOff: lo + pa, bOff: lo + pb });
    pa++; pb++;
  }
}
console.log(`Events: ${events.length}`);
let netIns = 0, netDel = 0, nSub = 0;
for (const e of events) {
  if (e.type === 'ins') netIns += e.len;
  else if (e.type === 'del') netDel += e.len;
  else nSub++;
}
console.log(`Net: ins=${netIns} del=${netDel} sub=${nSub}`);
for (const e of events.slice(0, 30)) {
  console.log(`  ${e.type} at A=${hex(e.aOff)} B=${hex(e.bOff)} len=${e.len || 1}`);
}
