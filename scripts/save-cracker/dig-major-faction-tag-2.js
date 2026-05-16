// Cross-reference major-record's u32@+28 (faction UUID candidate) against
// the per-character UUIDs found in the metadata records.

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
    records.push({ pos: i, treasury: buf.readInt32LE(i), regionCount: regions, factionTag: buf.readUInt32LE(i + 28) });
    i = Math.min(buf.length - 64, i + 92 + 4 * regions);
  }
  return records;
}

function findCharMetaRecs(buf) {
  const CHAR_CLASS_RE = /\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i;
  const out = [];
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let classStr = null, classStart = -1, classEnd = -1;
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
      if (CHAR_CLASS_RE.test(s) && /^[a-z][a-z _0-9]*[a-z0-9]$/i.test(s)) {
        classStr = s;
        classStart = p + 2;
        classEnd = p + 2 + lenP1;
        break;
      }
    }
    if (!classStr) continue;
    const m = classStr.match(/^(.*?)\s+(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)$/i);
    const factionWord = m ? m[1].toLowerCase().replace(/\s+/g, '_') : '?';
    // Per-character UUIDs A and B at classEnd+1 and classEnd+5
    const uuidA = buf.readUInt32LE(classEnd + 1);
    const uuidB = buf.readUInt32LE(classEnd + 5);
    out.push({ off: i, uuid, factionWord, className: classStr, uuidA, uuidB });
  }
  return out;
}

const majors = findMajors(A);
const charMeta = findCharMetaRecs(A);

console.log('Majors:', majors.length, '  Chars:', charMeta.length);
console.log();

const majorTagSet = new Set(majors.map(m => m.factionTag));
console.log('Major factionTags:');
majors.forEach((m, k) => console.log('  major[' + k + '] tag=0x' + m.factionTag.toString(16).padStart(8, '0') + '  regions=' + m.regionCount + '  treasury=' + m.treasury));

// Check: do any character UUID-A or UUID-B match a major's factionTag?
let hitsA = 0, hitsB = 0;
for (const c of charMeta) {
  if (majorTagSet.has(c.uuidA)) hitsA++;
  if (majorTagSet.has(c.uuidB)) hitsB++;
}
console.log('\n=== Cross-ref: character metadata UUIDs vs major-record factionTags ===');
console.log('  charMeta count:', charMeta.length);
console.log('  matches via UUID-A:', hitsA);
console.log('  matches via UUID-B:', hitsB);

// Now scan the WHOLE save for occurrences of each major's factionTag
// (count how many times it appears) — this tells us if these UUIDs are
// widely-referenced (faction handles) or one-off.
console.log('\n=== Occurrences of each major-record factionTag in the whole save ===');
const buf = A;
for (let k = 0; k < majors.length; k++) {
  const tag = majors[k].factionTag;
  // Scan for u32==tag
  let count = 0;
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === tag) count++;
  }
  console.log('  major[' + k + '] tag=0x' + tag.toString(16).padStart(8, '0') + '  occurrences=' + count);
}

// For the first major, dump all occurrence locations with surrounding context
console.log('\n=== Occurrences of major[0]\'s factionTag with surrounding context (first 10) ===');
const tag0 = majors[0].factionTag;
let found = 0;
for (let i = 0; i + 4 <= buf.length && found < 10; i++) {
  if (buf.readUInt32LE(i) === tag0) {
    // Skip if this is INSIDE major[0]'s record itself
    if (i >= majors[0].pos && i < majors[0].pos + 256) {
      console.log('  0x' + i.toString(16) + ' (inside major[0] record)');
    } else {
      console.log('  0x' + i.toString(16) + ' bytes -16..+16:');
      const startCtx = Math.max(0, i - 16);
      const endCtx = Math.min(buf.length, i + 20);
      const bytes = buf.subarray(startCtx, endCtx);
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const asc = Array.from(bytes).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
      console.log('    ' + hex + '  ' + asc);
    }
    found++;
  }
}
