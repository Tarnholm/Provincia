// Find spouse/marriage linkage by diffing T3 (pre-marriage) vs T4 (post-marriage).
// The user accepted a marriage at T4 start, so ONE character's record gained a
// spouse-pointer UUID.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T3 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 3.sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Find character records by scanning for the type-3 marker: 03 00 00 00 00 00 00 00
// followed by a u32 first_name index that's in plausible range.
function findCharacterRecords(buf) {
  const records = [];
  const marker = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  let p = 0;
  while (true) {
    const idx = buf.indexOf(marker, p);
    if (idx === -1) break;
    // Sanity: byte at +8 should be a u32 in range 50..50000 (name index)
    const nameIdx = buf.readUInt32LE(idx + 8);
    if (nameIdx >= 50 && nameIdx < 50000) {
      records.push({ off: idx, nameIdx });
    }
    p = idx + 8;
  }
  return records;
}

const t3rec = findCharacterRecords(T3);
const t4rec = findCharacterRecords(T4);
console.log('T3 character records: ' + t3rec.length);
console.log('T4 character records: ' + t4rec.length + ' (diff=' + (t4rec.length - t3rec.length) + ')');

// Look at character records by nameIdx — characters with same nameIdx are likely
// the same character.
// In T3 vs T4, find:
//   1. NEW records (nameIdx in T4 not in T3 — the new wife)
//   2. CHANGED records (same nameIdx but record bytes differ — gained spouse)

// First: which nameIdx values are in T4 but not T3?
const t3names = new Set(t3rec.map(r => r.nameIdx));
const t4names = new Set(t4rec.map(r => r.nameIdx));
const newInT4 = [...t4names].filter(n => !t3names.has(n));
const removedFromT3 = [...t3names].filter(n => !t4names.has(n));
console.log('\nNew character nameIdx values in T4 (' + newInT4.length + '): ' + newInT4.slice(0, 20).join(', '));
console.log('Removed nameIdx values from T3 (' + removedFromT3.length + '): ' + removedFromT3.slice(0, 20).join(', '));

// For each NEW character, dump the first 300 bytes of their record
console.log('\n=== NEW character records in T4 (first 200 bytes each) ===');
for (const nameIdx of newInT4.slice(0, 5)) {
  const rec = t4rec.find(r => r.nameIdx === nameIdx);
  if (!rec) continue;
  console.log('\nNameIdx ' + nameIdx + ' @ 0x' + rec.off.toString(16) + ':');
  for (let j = 0; j < 200; j += 32) {
    const len = Math.min(32, 200 - j);
    const hex = Array.from(T4.slice(rec.off + j, rec.off + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(rec.off + j, rec.off + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
  }
}

// Now for SHARED nameIdx values, check which record BYTES changed.
// Look at the first 300 bytes of each shared record.
console.log('\n\n=== Shared character records — find which one changed ===');
const sharedIdx = [...t3names].filter(n => t4names.has(n));
const changes = [];
for (const nameIdx of sharedIdx) {
  // Find one record each in T3 and T4
  const t3recs = t3rec.filter(r => r.nameIdx === nameIdx);
  const t4recs = t4rec.filter(r => r.nameIdx === nameIdx);
  if (t3recs.length !== t4recs.length) continue;
  for (let i = 0; i < t3recs.length; i++) {
    const a = t3recs[i].off;
    const b = t4recs[i].off;
    // Compare first 300 bytes
    let diffCount = 0;
    const diffOffs = [];
    for (let j = 0; j < 300; j++) {
      if (T3[a + j] !== T4[b + j]) {
        diffCount++;
        if (diffOffs.length < 10) diffOffs.push({ rel: j, t3: T3[a + j], t4: T4[b + j] });
      }
    }
    if (diffCount > 0) {
      changes.push({ nameIdx, t3off: a, t4off: b, diffCount, diffOffs });
    }
  }
}
console.log('Characters with bytes changed: ' + changes.length);
for (const c of changes.slice(0, 20)) {
  console.log('\n  nameIdx=' + c.nameIdx + ' T3@0x' + c.t3off.toString(16) + ' T4@0x' + c.t4off.toString(16) + ' diffs=' + c.diffCount);
  for (const d of c.diffOffs) {
    console.log('    +' + d.rel.toString().padStart(3) + ': T3=0x' + d.t3.toString(16).padStart(2, '0') + ' T4=0x' + d.t4.toString(16).padStart(2, '0'));
  }
}
