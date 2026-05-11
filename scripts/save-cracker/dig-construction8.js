#!/usr/bin/env node
// Find settlement-name UTF-16LE markers in both saves, match by name,
// and diff bytes BEFORE the name marker (since session 3 says settlement record
// extends ~2272 bytes BEFORE the name).

const fs = require('fs');
const path = require('path');

const dir = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves';
const A = fs.readFileSync(path.join(dir, 'save_saveturn1start.sav'));
const B = fs.readFileSync(path.join(dir, 'save_saveturn1construction.sav'));

// Find all UTF-16LE settlement-name markers: pattern `01 LEN_LO LEN_HI` followed by valid UTF-16
function findSettlementNames(buf) {
  const out = [];
  for (let i = 0; i < buf.length - 32; i++) {
    if (buf[i] !== 0x01) continue;
    const len = buf.readUInt16LE(i + 1);
    if (len < 3 || len > 30) continue;
    const start = i + 3;
    if (start + len * 2 > buf.length) continue;
    let ok = true;
    let s = '';
    for (let j = 0; j < len; j++) {
      const c = buf.readUInt16LE(start + j * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      s += String.fromCharCode(c);
    }
    if (!ok) continue;
    // Should start with capital letter
    if (!/^[A-Z][a-z]/.test(s)) continue;
    // Must end with letter (not numeric/special)
    if (!/[a-zA-Z]$/.test(s)) continue;
    out.push({ pos: i, len, name: s });
  }
  return out;
}

const sA = findSettlementNames(A);
const sB = findSettlementNames(B);

console.log(`A settlement names: ${sA.length}`);
console.log(`B settlement names: ${sB.length}`);

// Filter by uniqueness in each save (single-occurrence settlement names)
const cntA = new Map();
for (const s of sA) cntA.set(s.name, (cntA.get(s.name) || 0) + 1);
const uniqueA = sA.filter(s => cntA.get(s.name) === 1);
const cntB = new Map();
for (const s of sB) cntB.set(s.name, (cntB.get(s.name) || 0) + 1);
const uniqueB = sB.filter(s => cntB.get(s.name) === 1);

console.log(`A unique-name settlements: ${uniqueA.length}`);
console.log(`B unique-name settlements: ${uniqueB.length}`);

// Match unique settlements between A and B
const mapB = new Map();
for (const s of uniqueB) mapB.set(s.name, s);

const pairs = [];
for (const sa of uniqueA) {
  const sb = mapB.get(sa.name);
  if (sb) pairs.push({ name: sa.name, aPos: sa.pos, bPos: sb.pos });
}

console.log(`\nMatched ${pairs.length} settlements by name:`);
for (const p of pairs.slice(0, 50)) {
  console.log(`  ${p.name}: A@0x${p.aPos.toString(16)}, B@0x${p.bPos.toString(16)}`);
}

// For each pair, compute byte-diff of the BACKWARDS region (settlement record extends backward from name)
// and the FORWARDS region (building chain sub-records).
console.log('\n=== Per-settlement diff ===');
const SCAN_BACK = 2272;
const SCAN_FWD = 2000;

const diffs = [];
for (const p of pairs) {
  const aBack = p.aPos - SCAN_BACK;
  const bBack = p.bPos - SCAN_BACK;
  const aFwd = p.aPos + SCAN_FWD;
  const bFwd = p.bPos + SCAN_FWD;
  if (aBack < 0 || bBack < 0 || aFwd > A.length || bFwd > B.length) continue;

  let diffCount = 0;
  const diffOffsets = [];
  for (let j = 0; j < SCAN_BACK + SCAN_FWD; j++) {
    const aIdx = aBack + j;
    const bIdx = bBack + j;
    if (A[aIdx] !== B[bIdx]) {
      diffCount++;
      diffOffsets.push(j - SCAN_BACK); // relative to name marker
    }
  }
  diffs.push({ name: p.name, aPos: p.aPos, bPos: p.bPos, diffCount, diffOffsets });
}

diffs.sort((x, y) => y.diffCount - x.diffCount);
console.log(`Diffs (sorted desc by diff count):`);
for (const d of diffs) {
  console.log(`  ${d.name}: ${d.diffCount} bytes differ`);
  if (d.diffCount > 0 && d.diffCount < 40) {
    console.log(`    relative offsets (from name marker): ${d.diffOffsets.join(',')}`);
  } else if (d.diffCount > 0) {
    console.log(`    first 30 diff offsets: ${d.diffOffsets.slice(0, 30).join(',')}`);
  }
}
