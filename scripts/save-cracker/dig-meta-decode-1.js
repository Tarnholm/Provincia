// Session 111 — full-decode the companion metadata record found in session 110.
//
// At 0x01536440 in halo_oneman:
//   0x01536440: ef 00 00 00 2c 1a 97 f6  <- type=0xef, char-uuid=0xf6971a2c
//   0x01536448: 00 00 00 00 00 00 00 00
//   0x01536450: 00 00 00 00 00 00 01 00 0e 00 72 6f 6d 61 6e 20
//   0x01536460: 67 65 6e 65 72 61 6c 00 00 fa 3e 97 1d 15 a8 c4
//   0x01536470: a4 00 00 00 00 90 01 00 00 01 00 00 00 06 00 4c
//   0x01536480: 00 61 00 74 00 69 00 75 00 6d 00 ff ff ff ff 2c
//
// Goal: identify every field. In particular look for FACTION UUID — needed
// to pin diplomatic-marker-zone ownership.

const fs = require('fs');
const path = require('path');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

// Locate the metadata record for Gnaeus (uuid=0xf6971a2c) — same scan logic
// as parseCharacterMetadataByUuid.
const TARGET_UUID = 0xf6971a2c;

function findRec(buf, uuid) {
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    if (buf.readUInt32LE(i + 4) !== uuid) continue;
    return i;
  }
  return -1;
}

const off = findRec(A, TARGET_UUID);
console.log('Gnaeus metadata record at 0x' + off.toString(16));

// Walk forward — dump first 200 bytes with annotations
function hexLine(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  const hex = Array.from(slice).map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const ascii = Array.from(slice).map(b=>(b>=0x20&&b<0x7f)?String.fromCharCode(b):'.').join('');
  return hex + '  ' + ascii;
}
console.log('\n=== 256 bytes from record start ===');
for (let o = off; o < off + 256; o += 16) {
  console.log('  +0x' + (o - off).toString(16).padStart(2, '0') + '  0x' + o.toString(16) + ': ' + hexLine(A, o, 16));
}

// Walk through likely fields
console.log('\n=== Field-by-field decode ===');
function u32(o) { return A.readUInt32LE(off + o); }
function u16(o) { return A.readUInt16LE(off + o); }
function i32(o) { return A.readInt32LE(off + o); }

// First, find the variable-length ASCIIZ class string
let p = 0x10;
while (p < 0x40) {
  const lenP1 = u16(p);
  if (lenP1 >= 4 && lenP1 <= 50) {
    let ok = true;
    for (let j = 0; j < lenP1 - 1; j++) {
      const c = A[off + p + 2 + j];
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
    }
    if (ok && A[off + p + 2 + lenP1 - 1] === 0) {
      const s = A.subarray(off + p + 2, off + p + 2 + lenP1 - 1).toString('latin1');
      console.log('  +0x' + p.toString(16) + ': u16=' + lenP1 + ' len-prefixed ASCIIZ "' + s + '"');
      console.log('  +0x' + (p - 2).toString(16) + ': u16 prefix above = ' + u16(p - 2) + ' (other-context u16 immediately before)');
      p = p + 2 + lenP1;
      break;
    }
  }
  p++;
}

console.log('\n  Class string ended at +0x' + p.toString(16) + ' (file 0x' + (off + p).toString(16) + ')');

// After class string, look for UUIDs and the region pstr16 UTF-16
console.log('\n  Bytes after class string (+0x' + p.toString(16) + '..+0x' + (p + 64).toString(16) + '):');
for (let o = p; o < p + 64; o += 8) {
  const u32a = u32(o);
  const u32b = u32(o + 4);
  console.log('    +0x' + o.toString(16).padStart(2, '0') +
              ': u32a=0x' + u32a.toString(16).padStart(8, '0') + ' (' + u32a + ')' +
              '  u32b=0x' + u32b.toString(16).padStart(8, '0') + ' (' + u32b + ')');
}

// Find UTF-16 region pstr16
console.log('\n  Look for UTF-16 region pstr16:');
let utf16Start = -1;
for (let q = p; q < p + 80; q++) {
  const lenChars = u16(q);
  if (lenChars < 3 || lenChars > 40) continue;
  if (off + q + 2 + lenChars * 2 > A.length) continue;
  const chars = [];
  let ok = true;
  for (let j = 0; j < lenChars; j++) {
    const c = u16(q + 2 + j * 2);
    if (c < 0x20 || c > 0x7e) { ok = false; break; }
    chars.push(String.fromCharCode(c));
  }
  if (ok && /^[A-Z][A-Za-z _0-9-]*$/.test(chars.join(''))) {
    console.log('    +0x' + q.toString(16) + ': UTF-16 strlen=' + lenChars + ' "' + chars.join('') + '"');
    utf16Start = q;
    break;
  }
}

// Faction UUID hunt — scan the entire 256 bytes for u32 values that
// might be faction UUIDs. A faction UUID should:
//   - appear in the metadata records of MANY characters of the same faction
//   - be a non-trivial value (not a small int)
//   - possibly appear in faction-related structures elsewhere
//
// Approach: find all "non-trivial u32" values in this record and check
// which ones repeat across many of the 64 characters in halo_oneman.

console.log('\n=== Non-trivial u32 values in this record ===');
const interesting = [];
for (let o = 4; o < 200; o += 4) {
  const v = u32(o);
  // Filter: not 0, not 0xffffffff, not a self-pointer, not in 0..1000 range
  if (v === 0 || v === 0xffffffff) continue;
  if (v >= off - 0x10 && v <= off + 0x200) continue; // self-pointer
  if (v < 1000) continue; // small int (count, offset, etc.)
  interesting.push({ offset: o, value: v });
  console.log('  +0x' + o.toString(16).padStart(3, '0') + ': u32 = 0x' + v.toString(16).padStart(8, '0') + ' (' + v + ')');
}

// Now scan ALL 64 metadata records and see which u32s at fixed offsets repeat.
console.log('\n=== Repeated values across all 64 metadata records (factionUUID candidate analysis) ===');
function findAllRecs(buf) {
  const CHAR_CLASS_RE = /\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i;
  const out = [];
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let classStr = null, classEnd = -1;
    for (let p2 = i + 0x10; p2 < i + 0x40 && p2 + 2 < buf.length; p2++) {
      const lenP1 = buf.readUInt16LE(p2);
      if (lenP1 < 4 || lenP1 > 50) continue;
      if (p2 + 2 + lenP1 > buf.length) continue;
      let ok = true;
      for (let j = 0; j < lenP1 - 1; j++) {
        const c = buf[p2 + 2 + j];
        if (c < 0x20 || c > 0x7e) { ok = false; break; }
      }
      if (!ok) continue;
      if (buf[p2 + 2 + lenP1 - 1] !== 0) continue;
      const s = buf.slice(p2 + 2, p2 + 2 + lenP1 - 1).toString('latin1');
      if (CHAR_CLASS_RE.test(s) && /^[a-z][a-z _0-9]*[a-z0-9]$/i.test(s)) {
        classStr = s;
        classEnd = p2 + 2 + lenP1;
        break;
      }
    }
    if (!classStr) continue;
    out.push({ off: i, uuid, className: classStr, classEnd });
  }
  return out;
}

const allRecs = findAllRecs(A);
console.log('Total char metadata records:', allRecs.length);

// Group by className faction prefix
const byFactionWord = new Map();
for (const r of allRecs) {
  // Extract faction word (first word before "general"/"captain"/etc)
  const m = r.className.match(/^(.*?)\s+(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)$/i);
  if (!m) continue;
  const facWord = m[1].toLowerCase().replace(/\s+/g, '_');
  if (!byFactionWord.has(facWord)) byFactionWord.set(facWord, []);
  byFactionWord.get(facWord).push(r);
}
console.log('\nCharacters by faction word:');
const fwSorted = Array.from(byFactionWord.entries()).sort((a, b) => b[1].length - a[1].length);
for (const [fw, list] of fwSorted) {
  console.log('  ' + fw.padEnd(28) + list.length + '× (uuids: ' + list.slice(0, 3).map(x => '0x' + x.uuid.toString(16).padStart(8,'0')).join(', ') + (list.length > 3 ? ', ...' : '') + ')');
}

// For factions with >=2 characters, scan the metadata records for u32s
// that REPEAT across all characters of that faction. Those are candidate
// faction UUIDs.
console.log('\n=== u32-at-fixed-relative-offset that repeats across same-faction chars ===');
for (const [fw, list] of fwSorted) {
  if (list.length < 3) continue; // need at least 3 examples
  console.log('\n  Faction "' + fw + '" (' + list.length + ' chars):');
  // For each byte offset 0..200 from record start, check what u32 each char's record has there
  const offsetVals = new Map();
  for (let bo = 4; bo < 200; bo += 4) {
    const vals = new Set();
    let allValid = true;
    for (const r of list) {
      const o = r.off + bo;
      if (o + 4 > A.length) { allValid = false; break; }
      vals.add(A.readUInt32LE(o));
    }
    if (!allValid) continue;
    if (vals.size === 1) {
      const v = Array.from(vals)[0];
      if (v !== 0 && v !== 0xffffffff && v >= 1000 && v <= 0xffff0000) {
        console.log('    +0x' + bo.toString(16).padStart(3, '0') + ': SAME for all ' + list.length + ' (= 0x' + v.toString(16).padStart(8, '0') + ' / ' + v + ')');
        offsetVals.set(bo, v);
      }
    }
  }
}

// Cross-check: does any faction-shared u32 appear as a faction tag in
// the major-faction records (where session 5 said u32@+8 = 100 = "class tag")?
console.log('\n=== Hunting for major-faction records (class tag 100 at +8 of self-pointing section) ===');
const majors = [];
for (let i = 24; i < A.length - 64; i++) {
  if (A.readUInt32LE(i) !== i) continue; // self-pointer
  if (A.readUInt32LE(i + 8) !== 100) continue; // class tag = 100
  if (A.readUInt32LE(i + 12) !== 1) continue; // version = 1
  // Region count + region IDs make this a "major" record
  const N = A.readUInt32LE(i + 48);
  if (N > 200) continue;
  // First region ID sanity
  if (N > 0) {
    const r0 = A.readUInt32LE(i + 52);
    if (r0 > 1000) continue;
  }
  majors.push({ off: i, regionCount: N });
}
console.log('Found ' + majors.length + ' major-faction-style records');
for (const m of majors) {
  // Dump u32s at the first 40 bytes
  const vals = [];
  for (let o = 0; o < 40; o += 4) vals.push(A.readUInt32LE(m.off + o));
  console.log('  0x' + m.off.toString(16) + ' regions=' + m.regionCount + '  first10 u32: ' + vals.map(v => '0x' + v.toString(16)).join(' '));
}
