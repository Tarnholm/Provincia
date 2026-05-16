// dig-cpool-6.js — Session 106 / 6
// Verify ALL 178 pool records are byte-identical across saves (after positional realignment).
// Also: decode the structure of each pool record cleanly.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');
const SAVES = [
  'save_10_fresh.sav',
  'save_1.2.sav',
  'ror_t1e.sav',
  'ror_t2s.sav',
  'ror_t5.sav',
  'ror_t11s.sav',
  'ror_t11e.sav',
  'athens_t21.sav',
  'athens_t22e.sav',
];

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) { ok = false; break; }
    }
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

const allBodies = {};
for (const sv of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, sv));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarbAbs = findFirstBarbarian(buf, REC, REC + player.size);
  const walkEnd = Math.min(firstBarbAbs + 500*1024, REC + player.size);
  const records = walkPoolRecords(buf, firstBarbAbs, walkEnd);
  allBodies[sv] = { REC, firstBarbAbs, records, buf };
}

// Verify: for each record, compute body from afterString to next record's start
// Hash and compare across saves
const refSv = SAVES[0];
const refRecs = allBodies[refSv].records;
const refBuf = allBodies[refSv].buf;

const N = refRecs.length;
let allSame = 0, anyDiff = 0;
const diffs = [];
console.log('Per-record body hash compared across saves:');
for (let k = 0; k < N; k++) {
  const r0 = refRecs[k];
  const r1 = k + 1 < N ? refRecs[k + 1] : null;
  const refStart = r0.off + 2 + r0.strLen;
  const refEnd = r1 ? r1.off : r0.off + 5828; // assume size for last
  const refBody = refBuf.slice(refStart, refEnd);
  const refHash = crypto.createHash('sha1').update(refBody).digest('hex').slice(0, 16);

  let same = true;
  const perSaveHashes = { [refSv]: refHash };
  for (const sv of SAVES) {
    if (sv === refSv) continue;
    const recs = allBodies[sv].records;
    if (k >= recs.length) { same = false; perSaveHashes[sv] = 'MISSING'; continue; }
    const rr0 = recs[k];
    const rr1 = k + 1 < recs.length ? recs[k + 1] : null;
    if (rr0.text !== r0.text) { same = false; perSaveHashes[sv] = 'TEXT_MISMATCH'; continue; }
    const start = rr0.off + 2 + rr0.strLen;
    const end = rr1 ? rr1.off : rr0.off + 5828;
    if (end - start !== refEnd - refStart) { same = false; perSaveHashes[sv] = `SIZE_MISMATCH(${end-start})`; continue; }
    const body = allBodies[sv].buf.slice(start, end);
    const h = crypto.createHash('sha1').update(body).digest('hex').slice(0, 16);
    perSaveHashes[sv] = h;
    if (h !== refHash) same = false;
  }
  if (same) allSame++;
  else {
    anyDiff++;
    diffs.push({ idx: k, text: r0.text, hashes: perSaveHashes });
  }
}
console.log(`Records identical across all saves: ${allSame} / ${N}`);
console.log(`Records that differ: ${anyDiff} / ${N}`);
if (diffs.length > 0) {
  console.log('\nFirst 30 differing records:');
  for (const d of diffs.slice(0, 30)) {
    console.log(`  idx=${d.idx} "${d.text}"`);
    for (const sv of SAVES) console.log(`    ${sv.padEnd(35)} ${d.hashes[sv]}`);
  }
}

// Now decode the structure of pool records cleanly
// Goal: each record is <u16 strLen> <ASCII bytes> <u32 count> <u32 zero> <count u32 indices> <padding>
// Let's verify this on save_10_fresh for all 178 records
console.log('\n=== Pool record structure summary (save_10_fresh.sav) ===');
console.log('idx  text                            strLen  count  totalNonZeroAfter  recordSize  permUnique?');
const buf0 = allBodies[refSv].buf;
const recs0 = allBodies[refSv].records;

const structSummary = [];
for (let k = 0; k < recs0.length; k++) {
  const r = recs0[k];
  const rNext = k + 1 < recs0.length ? recs0[k + 1] : null;
  const recSize = rNext ? rNext.off - r.off : 5828;
  const bodyStart = r.off + 2 + r.strLen;
  const bodyLen = recSize - (2 + r.strLen);
  const count = buf0.readUInt32LE(bodyStart);
  const sep = buf0.readUInt32LE(bodyStart + 4);
  // Read count u32s
  let isPerm = true;
  const idxs = [];
  if (count > 0 && count < 1000 && bodyStart + 8 + count * 4 <= bodyStart + bodyLen) {
    for (let i = 0; i < count; i++) idxs.push(buf0.readUInt32LE(bodyStart + 8 + i * 4));
    const uniq = new Set(idxs);
    isPerm = uniq.size === count && Math.max(...idxs) === count - 1 && Math.min(...idxs) === 0;
  }
  // After the count*u32, what is the structure?
  // Look at u32 just after the perm
  const afterPerm = bodyStart + 8 + count * 4;
  const u32AfterPerm = afterPerm + 4 <= bodyStart + bodyLen ? buf0.readUInt32LE(afterPerm) : -1;
  // Count nonzero u32 in rest
  let nzRest = 0;
  let maxRest = 0;
  for (let i = afterPerm; i + 4 <= bodyStart + bodyLen; i += 4) {
    const v = buf0.readUInt32LE(i);
    if (v !== 0) { nzRest++; if (v > maxRest) maxRest = v; }
  }
  structSummary.push({
    idx: k, text: r.text, strLen: r.strLen, count, sep, recSize, isPerm,
    u32AfterPerm, nzRest, maxRest,
    afterPermOffset: afterPerm - bodyStart,
  });
  if (k < 60 || k > recs0.length - 5) {
    console.log(`${String(k).padStart(3)}  ${r.text.padEnd(28)}  ${String(r.strLen).padStart(4)}  ${String(count).padStart(5)}  nzRest=${String(nzRest).padStart(4)} maxRest=${String(maxRest).padStart(4)}  recSize=${String(recSize).padStart(5)}  perm?=${isPerm}`);
  }
}

// Aggregate: distribution of "count" values
const countDist = {};
for (const s of structSummary) {
  const k = s.count;
  countDist[k] = (countDist[k] || 0) + 1;
}
console.log('\nDistribution of "count" u32[0] across all 178 records:');
const dKeys = Object.keys(countDist).map(Number).sort((a,b)=>a-b);
for (const k of dKeys) console.log(`  count=${k}: ${countDist[k]} records`);

// And distribution of recordSize
const sizeDist = {};
for (const s of structSummary) sizeDist[s.recSize] = (sizeDist[s.recSize] || 0) + 1;
console.log('\nDistribution of record size:');
const sKeys = Object.keys(sizeDist).map(Number).sort((a,b)=>a-b);
for (const k of sKeys) console.log(`  size=${k}: ${sizeDist[k]} records`);

// All perm?
const nonPerm = structSummary.filter(s => !s.isPerm);
console.log(`\nNon-permutation records: ${nonPerm.length}`);
for (const s of nonPerm.slice(0, 20)) console.log(`  idx=${s.idx} "${s.text}" count=${s.count}`);

// Save
fs.writeFileSync(path.join(__dirname, 'out-cpool-6.json'), JSON.stringify({ structSummary, countDist, sizeDist, diffs }, null, 2));
console.log('\nWrote out-cpool-6.json');
