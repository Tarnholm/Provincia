// Hunt for an ARRAY of the 23 factionTags somewhere in the save. If they
// appear in any contiguous run (or even partial run), that's the
// faction-list table.

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
    records.push({ pos: i, factionTag: buf.readUInt32LE(i + 28) });
    i = Math.min(buf.length - 64, i + 92 + 4 * regions);
  }
  return records;
}

const majors = findMajors(A);
const tagSet = new Set(majors.map(m => m.factionTag));

// Scan the save for any 8-byte window containing two factionTags. Track
// "clusters" where multiple tags appear close together.
console.log('Scanning for contiguous-or-clustered factionTag occurrences...\n');

// First find ALL positions where ANY factionTag appears (excluding inside
// the major records themselves)
const allHits = [];
const majorRangeSet = majors.map(m => [m.pos, m.pos + 256]);
function insideMajor(pos) {
  return majorRangeSet.some(([s, e]) => pos >= s && pos < e);
}
for (let i = 0; i + 4 <= A.length; i++) {
  const v = A.readUInt32LE(i);
  if (tagSet.has(v) && !insideMajor(i)) {
    allHits.push({ pos: i, tag: v });
  }
}
console.log('Total factionTag occurrences (outside major records):', allHits.length);
console.log('Unique tags hit:', new Set(allHits.map(h => h.tag)).size);

// Find any window of 1000 bytes containing the MOST factionTag occurrences
let bestStart = 0, bestCount = 0;
const WIN = 1000;
let leftIdx = 0;
for (let rightIdx = 0; rightIdx < allHits.length; rightIdx++) {
  while (allHits[leftIdx].pos < allHits[rightIdx].pos - WIN) leftIdx++;
  const count = rightIdx - leftIdx + 1;
  if (count > bestCount) {
    bestCount = count;
    bestStart = allHits[leftIdx].pos;
  }
}
console.log('\nBest 1000-byte window:');
console.log('  starts at 0x' + bestStart.toString(16) + ', contains ' + bestCount + ' factionTag occurrences');
console.log('\nHits in this window:');
for (const h of allHits) {
  if (h.pos >= bestStart && h.pos < bestStart + WIN) {
    const k = majors.findIndex(m => m.factionTag === h.tag);
    console.log('  0x' + h.pos.toString(16) + '  tag=0x' + h.tag.toString(16).padStart(8, '0') + '  (major[' + k + '])');
  }
}

// Also try a tighter window — 100 bytes
let bestStart100 = 0, bestCount100 = 0;
const WIN100 = 100;
let leftIdx100 = 0;
for (let rightIdx = 0; rightIdx < allHits.length; rightIdx++) {
  while (allHits[leftIdx100].pos < allHits[rightIdx].pos - WIN100) leftIdx100++;
  const count = rightIdx - leftIdx100 + 1;
  if (count > bestCount100) {
    bestCount100 = count;
    bestStart100 = allHits[leftIdx100].pos;
  }
}
console.log('\nBest 100-byte window:');
console.log('  starts at 0x' + bestStart100.toString(16) + ', contains ' + bestCount100 + ' factionTag occurrences');

// Now let me try the OPPOSITE — scan for ANY position where 23 (or many)
// consecutive 4-byte u32s are ALL factionTags (i.e., a packed array).
console.log('\nSearching for packed arrays of factionTags (consecutive u32s)...');
for (let i = 0; i + 4 * 23 <= A.length; i++) {
  let runLen = 0;
  for (let k = 0; k < 23 && i + 4 * k + 4 <= A.length; k++) {
    const v = A.readUInt32LE(i + 4 * k);
    if (tagSet.has(v)) runLen++;
    else break;
  }
  if (runLen >= 3) {
    console.log('  packed run of ' + runLen + ' factionTags at 0x' + i.toString(16));
  }
}

// And: any 4-byte u32 that's a known factionTag, immediately followed by another factionTag
console.log('\nSearching for any factionTag-followed-by-factionTag (back-to-back u32s)...');
let pairs = 0;
for (let i = 0; i + 8 <= A.length; i++) {
  const v1 = A.readUInt32LE(i);
  if (!tagSet.has(v1)) continue;
  const v2 = A.readUInt32LE(i + 4);
  if (!tagSet.has(v2)) continue;
  pairs++;
  if (pairs <= 10) {
    console.log('  0x' + i.toString(16) + '  tag1=0x' + v1.toString(16).padStart(8, '0') + ' tag2=0x' + v2.toString(16).padStart(8, '0'));
  }
}
console.log('  total pairs found:', pairs);
