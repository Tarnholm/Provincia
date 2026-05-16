// Find the JOURNAL/EVENT-LOG section boundaries. The adoption record is
// at 0x2144b4b and starts with self-ptr=pos + u32=3 + i32 year. Find other
// records with the same shape.

const fs = require('fs');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const B = fs.readFileSync(BASE + 'save_t1adoption.sav');
const A = fs.readFileSync(BASE + 'save_t1.sav');

// Walk backwards from adoption to find the previous journal record(s)
console.log('=== Bytes immediately before adoption record (0x2144aXX in t1adoption) ===');
function dump(label, buf, off, len) {
  for (let o = off; o < off + len; o += 16) {
    const slice = buf.subarray(o, Math.min(o + 16, off + len));
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + label + ' 0x' + o.toString(16) + ': ' + hex.padEnd(48) + '  ' + asc);
  }
}
dump('B', B, 0x2144a00, 0x14B);

// Scan the whole file for "journal-like" records matching:
//   +0  u32 selfPtr = pos
//   +4  u32 = 3 (?)
//   +8  i32 year in (-3000..3000)
//   +20 u16 strlen reasonable
// in the 0x2100000..0x2200000 range
const ZONE_START = 0x02100000;
const ZONE_END   = 0x02200000;
const journals = [];
for (let p = ZONE_START; p + 30 < ZONE_END; p++) {
  if (B.readUInt32LE(p) !== p) continue;
  const v4 = B.readUInt32LE(p + 4);
  if (v4 > 1000) continue;  // small int
  const year = B.readInt32LE(p + 8);
  if (year < -3000 || year > 3000) continue;
  const strlen = B.readUInt16LE(p + 20);
  if (strlen < 2 || strlen > 80) continue;
  // Verify the UTF-16 string at +22 is plausible ASCII chars
  let ok = true;
  for (let k = 0; k < Math.min(strlen, 20); k++) {
    const c = B.readUInt16LE(p + 22 + k * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  // Read the first string
  const chars1 = [];
  for (let k = 0; k < strlen; k++) chars1.push(String.fromCharCode(B.readUInt16LE(p + 22 + k * 2)));
  journals.push({ off: p, year, v4, v12: B.readUInt32LE(p + 12), v16: B.readUInt32LE(p + 16), str1: chars1.join('') });
}
console.log('\nFound', journals.length, 'journal-like records in', '0x' + ZONE_START.toString(16) + '..0x' + ZONE_END.toString(16));
console.log('\nFirst 30 + last 5:');
const sorted = journals.slice().sort((a, b) => a.off - b.off);
for (const j of sorted.slice(0, 30)) {
  console.log('  0x' + j.off.toString(16) + '  yr=' + j.year + '  v4=' + j.v4 + '  v12=' + j.v12 + '  v16=' + j.v16 + '  str1="' + j.str1 + '"');
}
console.log('  ...');
for (const j of sorted.slice(-5)) {
  console.log('  0x' + j.off.toString(16) + '  yr=' + j.year + '  v4=' + j.v4 + '  v12=' + j.v12 + '  v16=' + j.v16 + '  str1="' + j.str1 + '"');
}

// Cross-check: how many of these exist in save_t1 (pre-adoption)?
const journalsA = [];
for (let p = ZONE_START; p + 30 < ZONE_END; p++) {
  if (A.readUInt32LE(p) !== p) continue;
  const v4 = A.readUInt32LE(p + 4);
  if (v4 > 1000) continue;
  const year = A.readInt32LE(p + 8);
  if (year < -3000 || year > 3000) continue;
  const strlen = A.readUInt16LE(p + 20);
  if (strlen < 2 || strlen > 80) continue;
  let ok = true;
  for (let k = 0; k < Math.min(strlen, 20); k++) {
    const c = A.readUInt16LE(p + 22 + k * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
  }
  if (!ok) continue;
  journalsA.push({ off: p });
}
console.log('\nSame scan on save_t1 (pre-adoption):', journalsA.length, 'journal-like records');

// Tag distribution by str1 (first string in record — likely character first name)
const str1Hist = new Map();
for (const j of journals) {
  str1Hist.set(j.str1, (str1Hist.get(j.str1) || 0) + 1);
}
console.log('\nTop 20 first-strings in journal records:');
const top = Array.from(str1Hist.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
for (const [s, n] of top) console.log('  ' + n + 'x  "' + s + '"');

// Read the SECOND string (event type) for each record
console.log('\n=== Event-type distribution (second pstr16) ===');
const evtHist = new Map();
for (const j of journals) {
  const p = j.off;
  const strlen1 = B.readUInt16LE(p + 20);
  let q = p + 22 + strlen1 * 2;
  if (q + 2 > B.length) continue;
  const strlen2 = B.readUInt16LE(q);
  if (strlen2 < 2 || strlen2 > 80) continue;
  q += 2;
  let ok = true;
  const chars = [];
  for (let k = 0; k < strlen2 && q + k * 2 + 2 <= B.length; k++) {
    const c = B.readUInt16LE(q + k * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
    chars.push(String.fromCharCode(c));
  }
  if (!ok) continue;
  const evt = chars.join('');
  evtHist.set(evt, (evtHist.get(evt) || 0) + 1);
}
const evtSorted = Array.from(evtHist.entries()).sort((a, b) => b[1] - a[1]);
for (const [e, n] of evtSorted.slice(0, 30)) console.log('  ' + n + 'x  "' + e + '"');
