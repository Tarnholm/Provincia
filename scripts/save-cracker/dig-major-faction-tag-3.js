// Investigate the early-file region (~0x3c2a) where major[0]'s factionTag
// first appears. Hypothesis: this is the FACTION TABLE with names + UUIDs.

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

// Dump a wide window around 0x3c2a — 1 KB before, 4 KB after
console.log('=== Header region around 0x3c2a (where major[0] factionTag first appears) ===\n');

function hexLine(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  return hex + '  ' + asc;
}
for (let o = 0x3a00; o < 0x4400; o += 16) {
  console.log('  0x' + o.toString(16).padStart(7, '0') + ': ' + hexLine(A, o, 16));
}

// Now find each of the 23 major factionTags' first occurrence — they
// might all be in this header region.
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
    records.push({ pos: i, factionTag: buf.readUInt32LE(i + 28) });
    i = Math.min(buf.length - 64, i + 92 + 4 * regions);
  }
  return records;
}
const majors = findMajors(A);

console.log('\n=== First occurrence of each major\'s factionTag (excluding inside its own record) ===');
for (let k = 0; k < majors.length; k++) {
  const tag = majors[k].factionTag;
  let first = -1;
  for (let i = 0; i + 4 <= A.length; i++) {
    if (A.readUInt32LE(i) === tag) {
      if (i >= majors[k].pos && i < majors[k].pos + 256) continue;
      first = i;
      break;
    }
  }
  console.log('  major[' + k + '] tag=0x' + tag.toString(16).padStart(8, '0') + '  first occurrence (outside record): 0x' + (first >= 0 ? first.toString(16) : 'NONE'));
}

// All these "first occurrences" — are they clustered in a single region?
console.log('\n=== Cluster analysis of first-occurrences ===');
const firsts = [];
for (let k = 0; k < majors.length; k++) {
  const tag = majors[k].factionTag;
  for (let i = 0; i + 4 <= A.length; i++) {
    if (A.readUInt32LE(i) === tag) {
      if (i >= majors[k].pos && i < majors[k].pos + 256) continue;
      firsts.push({ major: k, tag, offset: i });
      break;
    }
  }
}
firsts.sort((a, b) => a.offset - b.offset);
console.log('Sorted by file offset:');
for (const f of firsts) {
  console.log('  0x' + f.offset.toString(16) + '  major[' + f.major + ']  tag=0x' + f.tag.toString(16).padStart(8, '0'));
}

// If they cluster (e.g., all in 0x3c00..0x4400 region), that's the faction
// table. Dump bytes around each one.
console.log('\n=== Each first-occurrence with -20..+20 bytes context ===');
for (const f of firsts) {
  console.log('major[' + f.major + ']  0x' + f.offset.toString(16) + ':');
  const startCtx = Math.max(0, f.offset - 20);
  const endCtx = Math.min(A.length, f.offset + 24);
  const bytes = A.subarray(startCtx, endCtx);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(bytes).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  ' + hex + '  ' + asc);
}
