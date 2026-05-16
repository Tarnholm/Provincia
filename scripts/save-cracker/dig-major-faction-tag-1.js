// Hunt for a faction-identity tag inside each of the 23 major-faction
// records. The goal: identify each major's faction WITHOUT relying on
// file-order + descr_strat order assumption (which breaks after turn 0
// when factions are eliminated etc).
//
// Strategy:
//   1. Find all 23 major-records using Provincia's existing signature
//   2. For each, dump the first 96 bytes
//   3. Compare bytes that VARY across the 23 records — those are the
//      candidate per-faction identity fields
//   4. Cross-reference any UUIDs against:
//      (a) Known character UUIDs (faction leader UUID)
//      (b) Known region IDs (capital region — first region in list)

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

function findMajors(buf) {
  const records = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    const treasury = buf.readInt32LE(i);
    records.push({ pos: i, treasury, regionCount: regions });
    i = Math.min(buf.length - 64, i + 92 + 4 * regions);
  }
  return records;
}

const majors = findMajors(A);
console.log('Found', majors.length, 'major-faction records\n');

// Dump first 96 bytes of each major + region count
for (let k = 0; k < majors.length; k++) {
  const m = majors[k];
  console.log('=== major[' + k + '] @ 0x' + m.pos.toString(16) + ' treasury=' + m.treasury + ' regions=' + m.regionCount + ' ===');
  for (let o = 0; o < 96; o += 16) {
    const bytes = A.subarray(m.pos + o, m.pos + o + 16);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(bytes).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + o.toString(16).padStart(2, '0') + ': ' + hex + '  ' + asc);
  }
  // Region IDs
  const regionIds = [];
  for (let r = 0; r < Math.min(m.regionCount, 10); r++) {
    regionIds.push(A.readUInt32LE(m.pos + 52 + r * 4));
  }
  console.log('  regionIds (first 10):', regionIds.join(', '));

  // u32s at start that might be a faction tag
  const tag28 = A.readUInt32LE(m.pos + 28);
  console.log('  u32@+28 = 0x' + tag28.toString(16).padStart(8, '0') + ' (=' + tag28 + ')');
  console.log();
}

// Now look at u32@+28 across all 23 majors — is it unique per major?
console.log('=== u32@+28 across all 23 majors ===');
const tag28Vals = majors.map(m => A.readUInt32LE(m.pos + 28));
const tag28Set = new Set(tag28Vals);
console.log('  unique values:', tag28Set.size, '/', majors.length, tag28Set.size === majors.length ? '✓ UNIQUE PER MAJOR' : '✗ NOT UNIQUE');
console.log('  values:', Array.from(tag28Set).map(v => '0x' + v.toString(16)).join(', '));

// Cross-reference each major's u32@+28 against character UUIDs in the save
// (any faction leader UUID would also be a character UUID)
function findCharUuids(buf) {
  const out = new Set();
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    // Check this is a CHARACTER metadata record (has a class string)
    let isChar = false;
    for (let p = i + 0x10; p < i + 0x40 && p + 2 < buf.length; p++) {
      const lenP1 = buf.readUInt16LE(p);
      if (lenP1 < 4 || lenP1 > 50) continue;
      if (p + 2 + lenP1 > buf.length) continue;
      let ok = true;
      for (let j = 0; j < lenP1 - 1; j++) {
        const c = buf[p + 2 + j];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
      }
      if (!ok) continue;
      if (buf[p + 2 + lenP1 - 1] !== 0) continue;
      const s = buf.slice(p + 2, p + 2 + lenP1 - 1).toString('latin1');
      if (/\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i.test(s)) {
        isChar = true; break;
      }
    }
    if (isChar) out.add(uuid);
  }
  return out;
}

const charUuids = findCharUuids(A);
console.log('\nTotal character UUIDs found:', charUuids.size);

// Check if any major's u32@+28 is a character UUID
console.log('\n=== Cross-ref: u32@+28 of each major vs character UUIDs ===');
for (let k = 0; k < majors.length; k++) {
  const m = majors[k];
  const tag = A.readUInt32LE(m.pos + 28);
  const isCharUuid = charUuids.has(tag);
  console.log('  major[' + k + ']  u32@+28=0x' + tag.toString(16).padStart(8, '0') +
              '  isChar=' + isCharUuid +
              '  treasury=' + m.treasury +
              '  regions=' + m.regionCount);
}

// Also try the u32 at +(92 + 4*N + 4) onwards — there might be more identity fields
console.log('\n=== u32s at + (92 + 4*N) area of each major (post-region-list) ===');
for (let k = 0; k < Math.min(3, majors.length); k++) {
  const m = majors[k];
  const start = m.pos + 92 + 4 * m.regionCount;
  console.log('  major[' + k + ']  post-region-list area starting at +' + (start - m.pos) + ':');
  for (let o = 0; o < 64; o += 16) {
    const bytes = A.subarray(start + o, start + o + 16);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log('    +' + (start - m.pos + o).toString().padStart(4) + ': ' + hex);
  }
}
