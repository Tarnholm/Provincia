// dig-cpool-4.js — Session 106 / 4
// Goals:
// (1) Verify the pool zone is byte-identical across saves by hashing each pool record's body.
// (2) Estimate the size of the pool zone (end of last pool record).
// (3) Look at what's BEFORE the first "barbarian" string — that's the AI/diplo grid (session 103)
//     but the gap between the grid end (record-rel +0xc400) and the first barbarian (+0x12038 in T0)
//     is ~24 KB. Identify what's in that gap.
// (4) Identify what's AFTER the last pool record up to the Lua zone.

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

// Per-save record analysis with body hashes
const perSave = {};

for (const saveName of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, saveName));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const recEnd = REC + player.size;
  const firstBarbAbs = findFirstBarbarian(buf, REC, recEnd);
  const records = walkPoolRecords(buf, firstBarbAbs, Math.min(firstBarbAbs + 500*1024, recEnd));

  // Hash each record body (from after-string to next record's start)
  const recHashes = [];
  for (let k = 0; k < records.length; k++) {
    const bodyStart = records[k].off + 2 + records[k].strLen;
    const bodyEnd = (k+1 < records.length) ? records[k+1].off : Math.min(firstBarbAbs + 500*1024, recEnd);
    const body = buf.slice(bodyStart, bodyEnd);
    const h = crypto.createHash('sha1').update(body).digest('hex').slice(0, 16);
    recHashes.push({ idx: k, text: records[k].text, off: records[k].off, bodyLen: bodyEnd - bodyStart, hash: h });
  }

  perSave[saveName] = {
    REC,
    recordSize: player.size,
    firstBarbAbs,
    poolRecords: recHashes,
  };
}

// Compare hashes per record index across saves
console.log('\n=== Hash comparison per pool record across saves ===');
const numRecs = perSave[SAVES[0]].poolRecords.length;
const refSave = SAVES[0];
let nDiffer = 0;
let recordsThatDiffer = [];
for (let k = 0; k < numRecs; k++) {
  const refH = perSave[refSave].poolRecords[k].hash;
  const refTxt = perSave[refSave].poolRecords[k].text;
  let allSame = true;
  const valuesPerSave = {};
  for (const sv of SAVES) {
    const h = perSave[sv].poolRecords[k].hash;
    valuesPerSave[sv] = h;
    if (h !== refH) allSame = false;
  }
  if (!allSame) {
    nDiffer++;
    recordsThatDiffer.push({ idx: k, text: refTxt, valuesPerSave });
  }
}
console.log(`Records that differ between saves: ${nDiffer} of ${numRecs}`);
if (nDiffer > 0) {
  console.log('Differing records (first 10):');
  for (const r of recordsThatDiffer.slice(0, 10)) {
    console.log(`  idx=${r.idx} "${r.text}"`);
    for (const sv of SAVES) console.log(`    ${sv.padEnd(35)} ${r.valuesPerSave[sv]}`);
  }
}

// Now look at the GAP between the diplo grid end (rec_rel+0xc400) and the first pool record
// In T0, this is ~24 KB. In athens_t21, it's ~1 MB. So the gap is something else entirely.
console.log('\n=== Gap before first pool record ===');
console.log('save                              firstBarbRel  diff_from_0xc400');
for (const sv of SAVES) {
  const rel = perSave[sv].firstBarbAbs - perSave[sv].REC;
  console.log(`${sv.padEnd(35)} +0x${rel.toString(16)}    +${rel - 0xc400} (${((rel-0xc400)/1024).toFixed(1)} KB)`);
}

// Now look at the END of the pool zone — last record (aetolian_men) + 1 record size = end
// One more "aetolian_men" record in saves. Look at what comes after.
console.log('\n=== After last pool record ===');
for (const sv of SAVES) {
  const recs = perSave[sv].poolRecords;
  const last = recs[recs.length - 1];
  const buf = fs.readFileSync(path.join(FIX, sv));
  // 'aetolian_men' last record body length unknown, but the LAST record has length= bodyLen
  const after = last.off + 2 + last.text.length + last.bodyLen;
  console.log(`${sv.padEnd(35)} last(${last.text}) at abs 0x${last.off.toString(16)}  after_abs=0x${after.toString(16)}  rel_after=+0x${(after-perSave[sv].REC).toString(16)}`);
  // Show first 32 bytes after
  console.log(`  bytes after: ${buf.slice(after, after+32).toString('hex')}`);
}

// What's in the GAP at +0xc400 to +firstBarb in T0?
// Extract just T0 to look at the gap content
{
  const sv = 'save_10_fresh.sav';
  const buf = fs.readFileSync(path.join(FIX, sv));
  const REC = perSave[sv].REC;
  const gapStart = REC + 0xc400;
  const gapEnd = perSave[sv].firstBarbAbs;
  const gapLen = gapEnd - gapStart;
  console.log(`\n=== Gap in T0 (save_10_fresh): rel+0xc400..+0x${(gapEnd-REC).toString(16)} = ${gapLen} bytes ===`);
  const gap = buf.slice(gapStart, gapEnd);
  // Byte histogram
  let zero = 0, ff = 0, print = 0;
  for (const b of gap) {
    if (b === 0) zero++;
    else if (b === 0xff) ff++;
    else if (b >= 0x20 && b < 0x7f) print++;
  }
  console.log(`  zeros=${zero} (${(100*zero/gap.length).toFixed(1)}%)  ff=${ff}  printable=${print}`);
  // ASCII strings
  let s = -1;
  const ascii = [];
  for (let i = 0; i <= gap.length; i++) {
    const b = i < gap.length ? gap[i] : -1;
    const ok = b >= 0x20 && b < 0x7f;
    if (ok) { if (s === -1) s = i; }
    else {
      if (s !== -1 && i - s >= 4) ascii.push({ off: s, len: i - s, text: gap.slice(s, i).toString('latin1') });
      s = -1;
    }
  }
  console.log(`  ASCII strings (>=4 chars): ${ascii.length}`);
  for (const a of ascii.slice(0, 20)) {
    console.log(`    gap+0x${a.off.toString(16).padStart(4,'0')}  recRel+0x${(0xc400+a.off).toString(16)}  len=${a.len}  "${a.text}"`);
  }
  // First 256 bytes of gap as u32s
  console.log(`\n  First 32 u32 LE in gap:`);
  for (let i = 0; i < 32; i++) {
    const v = gap.readUInt32LE(i*4);
    console.log(`    gap+0x${(i*4).toString(16).padStart(4,'0')}  u32=${v}  hex=0x${v.toString(16).padStart(8,'0')}`);
  }

  // Stride check
  let s4 = 0, s4t = 0;
  for (let i = 0; i + 8 <= gap.length; i += 4) {
    s4t++;
    if (gap[i] === gap[i+4] && gap[i+1] === gap[i+5]) s4++;
  }
  console.log(`  stride-4 byte match rate: ${(100*s4/s4t).toFixed(1)}%`);
}

// Compare gap content across saves with hashes too
console.log('\n=== Gap hashes (record-rel +0xc400 to firstBarb) per save ===');
for (const sv of SAVES) {
  const buf = fs.readFileSync(path.join(FIX, sv));
  const REC = perSave[sv].REC;
  const gapStart = REC + 0xc400;
  const gapEnd = perSave[sv].firstBarbAbs;
  const gap = buf.slice(gapStart, gapEnd);
  const h = crypto.createHash('sha1').update(gap).digest('hex').slice(0, 16);
  console.log(`${sv.padEnd(35)} gapLen=${String(gap.length).padStart(7)}  hash=${h}`);
}

// Save
fs.writeFileSync(path.join(__dirname, 'out-cpool-4.json'), JSON.stringify({ perSave, recordsThatDiffer }, null, 2));
console.log('\nWrote out-cpool-4.json');
