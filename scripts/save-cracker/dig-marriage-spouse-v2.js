// Tighter character record finder using Provincia's actual validation.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T3 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 3.sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Stricter character record finder matching Provincia's validation
function findValidCharacterRecords(buf) {
  const records = [];
  const marker = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  let p = 0;
  while (true) {
    const i = buf.indexOf(marker, p);
    if (i === -1) break;
    p = i + 8;
    // Validate
    const firstIdx = buf.readUInt32LE(i + 8);
    if (firstIdx < 50 || firstIdx >= 50000) continue;
    // LAYOUT_A: byte +9 = 0, age@+26 (242 - buf[+26] in 0..100), role@+42 ≤ 10
    // LAYOUT_B: byte +5 = 0, age@+22, role@+38
    const tryLayout = (pad9, ageOff, roleOff) => {
      if (buf[i + pad9] !== 0) return false;
      const age = 242 - buf[i + ageOff];
      if (age < 0 || age > 100) return false;
      const role = buf[i + roleOff];
      if (role > 10) return false;
      return true;
    };
    const isA = tryLayout(9, 26, 42);
    const isB = tryLayout(5, 22, 38);
    if (!isA && !isB) continue;
    records.push({ off: i, nameIdx: firstIdx, layout: isA ? 'A' : 'B' });
  }
  return records;
}

const t3rec = findValidCharacterRecords(T3);
const t4rec = findValidCharacterRecords(T4);
console.log('T3 character records: ' + t3rec.length);
console.log('T4 character records: ' + t4rec.length + ' (diff=' + (t4rec.length - t3rec.length) + ')');

// Each character is uniquely identified by their "secondary UUID" at offset -43 from record start
// (per Provincia's v1 parser comment).
function getSecondaryUuid(buf, off) {
  if (off - 43 < 0) return null;
  return buf.readUInt32LE(off - 43);
}

// Build maps: uuid → record offset
const t3byUuid = new Map();
const t4byUuid = new Map();
for (const r of t3rec) {
  const u = getSecondaryUuid(T3, r.off);
  if (u !== null && u !== 0xffffffff && u !== 0) t3byUuid.set(u, r);
}
for (const r of t4rec) {
  const u = getSecondaryUuid(T4, r.off);
  if (u !== null && u !== 0xffffffff && u !== 0) t4byUuid.set(u, r);
}
console.log('\nCharacters by secondary UUID:');
console.log('  T3: ' + t3byUuid.size);
console.log('  T4: ' + t4byUuid.size);

// NEW characters: UUID in T4 but not T3
const newInT4 = [...t4byUuid.keys()].filter(u => !t3byUuid.has(u));
const removedFromT3 = [...t3byUuid.keys()].filter(u => !t4byUuid.has(u));
console.log('  NEW in T4: ' + newInT4.length);
console.log('  REMOVED from T3: ' + removedFromT3.length);

// If only 1-2 new characters appear, they're the bride
for (const uuid of newInT4) {
  const r = t4byUuid.get(uuid);
  console.log('\n=== NEW character in T4 (uuid=0x' + uuid.toString(16) + ') @ 0x' + r.off.toString(16) + ' ===');
  // Dump 300 bytes
  for (let j = -47; j < 300; j += 32) {
    const len = Math.min(32, 300 - j);
    const hex = Array.from(T4.slice(r.off + j, r.off + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(r.off + j, r.off + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + (j >= 0 ? '+' : '') + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
  }
}

// CHANGED characters: same UUID but a u32 field flipped from 0 / 0xffffffff to a non-trivial UUID
console.log('\n=== Characters where a u32 field went from "empty" to "UUID" between T3 and T4 ===');
const sharedUuids = [...t3byUuid.keys()].filter(u => t4byUuid.has(u));
for (const uuid of sharedUuids) {
  const r3 = t3byUuid.get(uuid);
  const r4 = t4byUuid.get(uuid);
  // Diff u32 fields in range -50..+200 from record start
  for (let dx = -50; dx < 200; dx += 1) {
    const v3 = T3.readUInt32LE(r3.off + dx);
    const v4 = T4.readUInt32LE(r4.off + dx);
    if (v3 === v4) continue;
    // Was empty (0 or 0xffffffff), now has UUID-like non-empty value
    const wasEmpty = (v3 === 0 || v3 === 0xffffffff);
    const nowHasValue = (v4 !== 0 && v4 !== 0xffffffff && v4 > 0x1000);
    if (wasEmpty && nowHasValue) {
      // Is the new value a valid character UUID (= matches another character's secondary UUID)?
      const isCharUuid = t4byUuid.has(v4);
      if (isCharUuid) {
        const tgt = t4byUuid.get(v4);
        console.log('  uuid 0x' + uuid.toString(16) + ' @ 0x' + r3.off.toString(16) +
          '  field +' + dx + ' empty→0x' + v4.toString(16) +
          '  (points to ANOTHER character at 0x' + tgt.off.toString(16) + ')');
      }
    }
  }
}
