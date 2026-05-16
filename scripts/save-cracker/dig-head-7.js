// dig-head-7.js — Session 107 / 7
// Better characterize what's in the "settlement-class records" zone at the start of HEAD.
// The records look like: <u16 strLen><ASCII class>\0  with surrounding fields.
// Some have 'gap=0' (immediately abutting class name) which means the class is just a string-ref.
// Look at the structure more carefully and see if these records contain region/settlement IDs.

'use strict';

const fs = require('fs');
const path = require('path');
const { findFactionRecords } = require('../../src/factionRecordParser.js');

const FIX = path.join(__dirname, 'fixtures', 'feral');

function findFirstBarbarian(buf, recStart, recEnd) {
  const needle = Buffer.from([0x0a, 0x00, 0x62, 0x61, 0x72, 0x62, 0x61, 0x72, 0x69, 0x61, 0x6e, 0x00]);
  for (let i = recStart; i + needle.length < recEnd; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) if (buf[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function getHead(savFile) {
  const buf = fs.readFileSync(path.join(FIX, savFile));
  const recs = findFactionRecords(buf);
  const player = recs[recs.length - 1];
  const REC = player.offset;
  const firstBarb = findFirstBarbarian(buf, REC, REC + player.size);
  return { head: buf.slice(REC + 0xc400, firstBarb), file: savFile };
}

// Use a different decoder: walk forward, treat each record as
//   <u32 record-magic> <fields> <u16 strLen> <ASCII class> [<u16 strLen> <ASCII class>?]
// Each record can have 1 or 2 ASCII strings.

const MAGIC = Buffer.from([0xff, 0x0a, 0xaf, 0xf0]);

function walkBuildingRecs(head, magicIdx) {
  const out = [];
  let i = 0;
  while (i < magicIdx - 2) {
    // Look for a u16 strLen with valid string. Record may start with some fields before strLen.
    const len = head.readUInt16LE(i);
    if (len < 8 || len > 30) { i++; continue; }
    let ok = true;
    for (let k = 0; k < len - 1; k++) {
      const c = head[i + 2 + k];
      if (c < 0x20 || c >= 0x7f) { ok = false; break; }
    }
    if (!ok || head[i + 2 + len - 1] !== 0) { i++; continue; }
    const s = head.slice(i + 2, i + 2 + len - 1).toString('ascii');
    if (!(s[0] >= 'A' && s[0] <= 'Z') || !/^[A-Za-z_]+$/.test(s)) { i++; continue; }
    out.push({ off: i, len, s });
    i += 2 + len;
  }
  return out;
}

// In ror_t11s, decode the bytes between two consecutive class-name records
console.log(`=== ror_t11s: detailed look at adjacent class-name records and inter-record bytes ===`);
{
  const { head } = getHead('ror_t11s.sav');
  const magicIdx = head.indexOf(MAGIC);
  const recs = walkBuildingRecs(head, magicIdx);
  console.log(`  ${recs.length} class-name records before magic at +0x${magicIdx.toString(16)}`);

  // Identify "double-string" records by looking for adjacent strings (gap==0)
  let doubleCount = 0, singleCount = 0;
  for (let i = 1; i < recs.length; i++) {
    const a = recs[i - 1], b = recs[i];
    const aEnd = a.off + 2 + a.len;
    if (b.off === aEnd) doubleCount++;
    else singleCount++;
  }
  console.log(`  Adjacent (double-string) records: ${doubleCount}`);
  console.log(`  Non-adjacent (single-string with gap): ${singleCount}`);

  // Decode a typical record more carefully. We'll group records into "logical records" where
  // the structure is `<header fields> <strLen><ASCII> [<strLen><ASCII> if double]`.
  // The header before the first string is what we need to decode.

  // Walk and group into LOGICAL records (each logical record may have 1 or 2 strings)
  const logical = [];
  let cursor = 0;
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
    let endStr = r.off + 2 + r.len;
    // Check if next record is adjacent (double string)
    let secondStr = null;
    if (k + 1 < recs.length && recs[k + 1].off === endStr) {
      secondStr = recs[k + 1];
      endStr = secondStr.off + 2 + secondStr.len;
      k++; // skip the second one
    }
    logical.push({
      recStart: cursor,
      recEnd: endStr,
      headerBytes: r.off - cursor,
      firstStr: r.s,
      secondStr: secondStr ? secondStr.s : null,
    });
    cursor = endStr;
  }
  console.log(`  Logical records: ${logical.length}`);

  // Header size distribution
  const hdrSizes = new Map();
  for (const l of logical) hdrSizes.set(l.headerBytes, (hdrSizes.get(l.headerBytes) || 0) + 1);
  console.log(`  Header-bytes-before-first-string distribution:`);
  for (const [k, v] of [...hdrSizes.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10)) {
    console.log(`    headerBytes=${k}  count=${v}`);
  }

  // Show first 4 logical records and their full bytes
  console.log(`\n  First 4 logical records:`);
  for (let i = 0; i < 4 && i < logical.length; i++) {
    const l = logical[i];
    console.log(`\n  Rec ${i}: +0x${l.recStart.toString(16)}..+0x${l.recEnd.toString(16)} hdr=${l.headerBytes}B  ${JSON.stringify(l.firstStr)}${l.secondStr ? ' + ' + JSON.stringify(l.secondStr) : ''}`);
    for (let j = l.recStart; j < l.recEnd; j += 16) {
      process.stdout.write(`    +0x${j.toString(16).padStart(5,'0')}  `);
      for (let m = 0; m < 16 && j+m < l.recEnd; m++) process.stdout.write(head[j+m].toString(16).padStart(2,'0')+' ');
      for (let m = (l.recEnd - j); m < 16; m++) process.stdout.write('   ');
      process.stdout.write('  ');
      for (let m = 0; m < 16 && j+m < l.recEnd; m++) {
        const c = head[j+m];
        process.stdout.write(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
      }
      console.log();
    }
  }

  // Cross-correlate first u32 of each logical record's header field with regions.
  // The example record 2 was:
  //   1b 00 00 00 d8 00 00 00 ef 01 00 00 01 00 00 00 ff ff ff ff
  //   12 00 00 00 16 00 00 00 02 00 00 00 21 00 00 00 0c 00 [strlen+"Celtic_Town"]
  // 0x1b = 27, 0xd8 = 216, 0x01ef = 495, 0x01 = 1, 0xffffffff = sentinel, 0x12, 0x16, 0x02, 0x21
  // 0x21 = 33 -- could be settlement_id; 0x16 = 22 -- could be region_id; 0x02 = 2 -- could be culture_id

  // Histogram of "first u32 of header" -- if it's a turn number, should have only a few distinct values
  const firstU32 = new Map();
  for (const l of logical) {
    if (l.headerBytes >= 4) {
      const v = head.readUInt32LE(l.recStart);
      firstU32.set(v, (firstU32.get(v) || 0) + 1);
    }
  }
  console.log(`\n  First u32 of header (distinct): ${firstU32.size}`);
  const fu32sorted = [...firstU32.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`  Top 15 most frequent first-u32 values:`);
  for (const [v, c] of fu32sorted.slice(0, 15)) console.log(`    ${v} = 0x${v.toString(16)}  count=${c}`);

  // The Rec 2 had 0x1b at start which equals 27, and field 5 was 0x21=33 (settlement_id?).
  // Field 4 was 0x16=22 (region?). The class name is the settlement class.
  // Look at the distribution of THESE positions:
  //   field 4 (offset header-4): possibly a region/settlement-class enum?
  //   field 5 (offset header-8 from end): probably settlement id

  // Build a per-record summary: which settlement IDs?
  // Find all distinct u32 values appearing at fixed offsets inside headers.
  // Use "third u32 from end of header" since that's where Rec 2 had 0x21 (settlement_id 33).
  // But headers have varied sizes (27, 36, 0) so we need to be careful.
  // Just show distribution of the u32 immediately preceding the first strLen:
  const lastU32 = new Map();
  for (const l of logical) {
    if (l.headerBytes >= 4) {
      const v = head.readUInt32LE(l.recStart + l.headerBytes - 4);
      lastU32.set(v, (lastU32.get(v) || 0) + 1);
    }
  }
  console.log(`\n  Last u32 of header (just before first strLen) distinct: ${lastU32.size}`);
  const lu32sorted = [...lastU32.entries()].sort((a,b)=>b[1]-a[1]);
  console.log(`  Top 15:`);
  for (const [v, c] of lu32sorted.slice(0, 15)) console.log(`    ${v} = 0x${v.toString(16)}  count=${c}`);
}

// Now check: does the count of building/state records correlate with the # of settlements in the campaign world?
// In RIS imperial, 239 factions => ~240 regions => ~240 settlements.
// athens_t21 has 582 records, t11s 481, t5 210. Let's see if there's a pattern.

console.log(`\n=== Class-name-record growth profile ===`);
const SAVES = ['ror_t1e.sav', 'ror_t2s.sav', 'ror_t5.sav', 'ror_t11s.sav', 'ror_t11e.sav', 'athens_t21.sav', 'athens_t22s.sav', 'athens_t22mid.sav', 'athens_t22e.sav'];
console.log(`save                        nRecs    distinct  doubleStr  singleStr`);
for (const sv of SAVES) {
  const { head } = getHead(sv);
  const magicIdx = head.indexOf(MAGIC);
  if (magicIdx <= 0) { console.log(`${sv.padEnd(28)}  (no magic)`); continue; }
  const recs = walkBuildingRecs(head, magicIdx);
  const distinct = new Set(recs.map(r => r.s));
  let doubleCount = 0;
  for (let i = 1; i < recs.length; i++) {
    if (recs[i].off === recs[i-1].off + 2 + recs[i-1].len) doubleCount++;
  }
  console.log(`${sv.padEnd(28)}  ${recs.length.toString().padStart(5)}  ${distinct.size.toString().padStart(7)}  ${doubleCount.toString().padStart(9)}  ${(recs.length - 2*doubleCount).toString().padStart(9)}`);
}
