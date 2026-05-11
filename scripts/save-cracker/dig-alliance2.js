// dig-alliance2.js
// Search for the byte sequences that would denote an alliance.
// In RTW alliance state could be:
//   (a) A flag on each faction record (boolean per-pair) — would be a single byte change
//   (b) A list of "allies" per faction — would be an inserted u8/u16 index entry
//   (c) A separate alliance-list array
// The diplomacy matrix is unchanged, so look elsewhere.
//
// Approach: count, in save_2 vs save_3, the number of times byte values
// 156 (messapians idx) appear among small clusters, and compare. Also:
// find any byte sequence that contains BOTH 0 and 156 (romans+messapians)
// near each other.

const fs = require('fs');
const path = require('path');
const SAVES_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const s2 = fs.readFileSync(path.join(SAVES_DIR,'save_2.1.sav'));
const s3 = fs.readFileSync(path.join(SAVES_DIR,'save_3.1.sav'));
const s1 = fs.readFileSync(path.join(SAVES_DIR,'save_1.1.sav'));

// Count occurrences of the u32 "156" (messapians idx) preceded/followed by u32 "0" (romans)
function findPattern(buf, pattern) {
  const hits = [];
  let i = 0;
  while (i < buf.length - pattern.length) {
    const k = buf.indexOf(pattern, i);
    if (k < 0) break;
    hits.push(k);
    i = k + 1;
  }
  return hits;
}

// Pattern: u32(0) u32(156)
const p_0_156 = Buffer.from([0,0,0,0, 156,0,0,0]);
// Pattern: u32(156) u32(0)
const p_156_0 = Buffer.from([156,0,0,0, 0,0,0,0]);
// Pattern: u8 0 then u8 156 within next 3 bytes
// (alliance "list entries" often store 4-byte faction-ID with 3 high bytes 0)
const p_u16_0 = Buffer.from([0, 0]);
const p_u16_156 = Buffer.from([156, 0]);

console.log('Looking for byte pattern u32(0) followed immediately by u32(156)...');
for (const [label, buf] of [['save_1', s1], ['save_2', s2], ['save_3', s3]]) {
  const h = findPattern(buf, p_0_156);
  console.log(`  ${label}: ${h.length} hits`);
}
console.log('Looking for byte pattern u32(156) followed immediately by u32(0)...');
for (const [label, buf] of [['save_1', s1], ['save_2', s2], ['save_3', s3]]) {
  const h = findPattern(buf, p_156_0);
  console.log(`  ${label}: ${h.length} hits`);
}

// Look for `9c 00 00 00` (=156 as u32) occurrences. The matrix has it as
// a column index, so we'll see ~239 occurrences (one per row of column 156).
// But there should be EXTRA occurrences in save_3 vs save_2 if alliance
// writes faction-156 references.
const pu32_156 = Buffer.from([156, 0, 0, 0]);
const pu32_0   = Buffer.from([0, 0, 0, 0]);
console.log('\nOccurrences of u32=156 (messapians idx):');
for (const [label, buf] of [['save_1', s1], ['save_2', s2], ['save_3', s3]]) {
  const h = findPattern(buf, pu32_156);
  console.log(`  ${label}: ${h.length} hits`);
}

// Look for the new u32=156 positions in save_3 that aren't in save_2
console.log('\nNew u32=156 positions in save_3 vs save_2:');
const hits2 = new Set(findPattern(s2, pu32_156));
const hits3 = findPattern(s3, pu32_156);
const newPos = hits3.filter(p => !hits2.has(p));
console.log(`  new positions (count): ${newPos.length}  (positions: ${newPos.slice(0,30).map(p=>'0x'+p.toString(16)).join(', ')})`);

// To rule out byte-level shifts, we should also check what's around these positions.
// But save_3 is shifted relative to save_2 by inserts. Let's just dump context for the first few new positions.
function hex(buf, off, n=64) { const s=[]; for (let i=0;i<n && off+i<buf.length;i++) s.push(buf[off+i].toString(16).padStart(2,'0')); return s.join(' '); }
function ascii(buf, off, n=64) { let s=''; for (let i=0;i<n && off+i<buf.length;i++){ const b=buf[off+i]; s+=(b>=32 && b<127)?String.fromCharCode(b):'.'; } return s; }
console.log('\nContext for the first 10 NEW u32=156 hits in save_3:');
for (const p of newPos.slice(0, 10)) {
  console.log(`  @ 0x${p.toString(16)}: ${hex(s3, Math.max(0,p-16), 64)}`);
  console.log(`    ASCII: ${ascii(s3, Math.max(0,p-16), 64)}`);
}

// Search for "Messapians" or "messapians" strings in both saves to see if a faction record (ASCII reference) was created
function countString(buf, str) {
  const pat = Buffer.from(str, 'utf8');
  return findPattern(buf, pat).length;
}
function countUTF16(buf, str) {
  const pat = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) pat.writeUInt8(str.charCodeAt(i), i*2);
  return findPattern(buf, pat).length;
}
console.log('\nMessapians/messapians/Messapian string counts:');
for (const [label, buf] of [['save_1', s1], ['save_2', s2], ['save_3', s3]]) {
  console.log(`  ${label}: 'messapians' (utf8)=${countString(buf, 'messapians')} 'Messapians' (utf16)=${countUTF16(buf, 'Messapians')}`);
}
