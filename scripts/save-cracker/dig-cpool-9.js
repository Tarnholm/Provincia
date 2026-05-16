// dig-cpool-9.js — Session 106 / 9
// Improved sub-pool walker that handles zero padding between sub-pools.
// Plus map ALL sub-pool counts inside ALL 178 culture records.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = [
  'save_10_fresh.sav', 'save_1.2.sav', 'ror_t1e.sav',
  'ror_t2s.sav', 'ror_t5.sav', 'ror_t11s.sav',
  'ror_t11e.sav', 'athens_t21.sav', 'athens_t22e.sav',
];

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function walkPoolRecords(buf, start, end) {
  const found = [];
  let i = start;
  while (i + 3 < end) {
    const strLen = buf.readUInt16LE(i);
    if (strLen < 3 || strLen > 30) { i++; continue; }
    if (i + 2 + strLen > end) break;
    let ok = true;
    let txt = '';
    for (let j = 0; j < strLen; j++) {
      const b = buf[i + 2 + j];
      if (b === 0 && j === strLen - 1) break;
      if (b < 0x20 || b >= 0x7f) { ok = false; break; }
      txt += String.fromCharCode(b);
    }
    if (!ok || !/[a-zA-Z]/.test(txt)) { i++; continue; }
    if (!/_men$|_women$|_surnames$/.test(txt) && !['barbarian','greek','eastern','egyptian','roman','carthaginian','nomad','parthian','blank'].includes(txt)) {
      i++; continue;
    }
    found.push({ off: i, strLen, text: txt });
    i += 2 + strLen;
  }
  return found;
}

// Improved sub-pool walker. Scans body for valid "<u32 count> <u32 0> <count u32 indices>" sub-pools.
// Skips zero-padding between sub-pools.
function walkSubPoolsRobust(body) {
  const sub = [];
  let i = 0;
  while (i + 8 <= body.length) {
    // Read prospective count
    const count = body.readUInt32LE(i);
    const sep = body.readUInt32LE(i + 4);
    // Valid sub-pool: count in (0, 600], sep in {0, 1, very small}, count u32s fit
    if (count > 0 && count <= 600 && sep < 100 && i + 8 + count * 4 <= body.length) {
      // Check indices are bounded
      let maxIdx = 0, hasNegative = false;
      for (let j = 0; j < count; j++) {
        const v = body.readUInt32LE(i + 8 + j * 4);
        if (v > maxIdx) maxIdx = v;
        if (v > 0xfffff && v < 0xffffff00) { hasNegative = true; break; }
      }
      if (!hasNegative && maxIdx < count + 50) {
        sub.push({ off: i, count, sep, max: maxIdx });
        i += 8 + count * 4;
        continue;
      }
    }
    // Not a valid sub-pool start, advance by 4 (or 1 if alignment broken)
    i += 4;
  }
  return sub;
}

// Now run on all 178 records, building a map of "(record idx, text) => sub-pool count sequence"
const sv = SAVES[0];
const buf = fs.readFileSync(path.join(FIX, sv));
const recs = findFactionRecords(buf);
const player = recs[recs.length - 1];
const REC = player.offset;
const firstBarbAbs = findFirstBarbarian(buf, REC, REC + player.size);
const walkEnd = Math.min(firstBarbAbs + 500*1024, REC + player.size);
const records = walkPoolRecords(buf, firstBarbAbs, walkEnd);

console.log('idx  text                            recSize   subPools (count: occurrences)');
const allSubData = [];
for (let k = 0; k < records.length; k++) {
  const r = records[k];
  const r1 = k + 1 < records.length ? records[k + 1] : null;
  const recEnd = r1 ? r1.off : r.off + 5828;
  const bs = r.off + 2 + r.strLen;
  const body = buf.slice(bs, recEnd);
  const subs = walkSubPoolsRobust(body);
  const cnts = {};
  for (const s of subs) cnts[s.count] = (cnts[s.count] || 0) + 1;
  const histStr = Object.entries(cnts).sort((a,b)=>b[0]-a[0]).map(([c,n])=>`${c}×${n}`).join(' ');
  if (k < 22 || k > records.length - 5) {
    console.log(`${String(k).padStart(3)}  ${r.text.padEnd(28)}  recSize=${String(recEnd - r.off).padStart(5)}  subs=${subs.length}  ${histStr}`);
  }
  allSubData.push({ idx: k, text: r.text, recSize: recEnd - r.off, subPoolCounts: subs.map(s => s.count) });
}

// Now: among the first 21 culture records, look for patterns
// barbarian (5828 B): how many sub-pools and which counts
// greek (8168 B): how many sub-pools and which counts
console.log('\n=== Per-culture sub-pool count signatures ===');
const cultures = ['barbarian', 'greek', 'eastern', 'egyptian'];
for (const cu of cultures) {
  const recsCu = allSubData.filter(d => d.text === cu);
  console.log(`\n${cu}: ${recsCu.length} records`);
  for (const r of recsCu) {
    console.log(`  idx=${r.idx} recSize=${r.recSize} ${r.subPoolCounts.length} sub-pools = [${r.subPoolCounts.join(',')}]`);
  }
}

// Verify pattern: each culture has a FIXED sub-pool count pattern
// barbarian = [42,42,151,42,42,42,151,151,151,151,151,151,151] (with the +5176 fix)
// Let me re-look at idx=0 with new walker
console.log('\n=== Re-walk idx=0 barbarian with robust walker ===');
{
  const r = records[0];
  const r1 = records[1];
  const bs = r.off + 2 + r.strLen;
  const body = buf.slice(bs, r1.off);
  const subs = walkSubPoolsRobust(body);
  for (const s of subs) console.log(`  off=+${s.off} count=${s.count} sep=${s.sep} max=${s.max}`);
}

// HYPOTHESIS test: do the COUNTS in barbarian's subpools = total counts from named lists?
// e.g. is sub-pool count 42 = a named name list with 42 elements?
// Look at named lists with counts 42 and 151:
console.log('\n=== Named pool records with count == 42 or 151 ===');
for (const d of allSubData) {
  const r = records[d.idx];
  const bs = r.off + 2 + r.strLen;
  const cnt = buf.readUInt32LE(bs);
  if (cnt === 42 || cnt === 151) {
    console.log(`  idx=${d.idx} "${d.text}" count=${cnt}`);
  }
}

// Same for greek (count 55, 188, 45)
console.log('\n=== Named pool records with count == 55 or 188 or 45 ===');
for (const d of allSubData) {
  const r = records[d.idx];
  const bs = r.off + 2 + r.strLen;
  const cnt = buf.readUInt32LE(bs);
  if (cnt === 55 || cnt === 188 || cnt === 45) {
    console.log(`  idx=${d.idx} "${d.text}" count=${cnt}`);
  }
}
