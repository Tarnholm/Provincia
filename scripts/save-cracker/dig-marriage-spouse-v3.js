// Looser character record detection — try both layouts independently with less strict checks

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T3 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 3.sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

function findCharacterRecords(buf) {
  const records = [];
  const marker = Buffer.from([0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  let p = 0;
  while (true) {
    const i = buf.indexOf(marker, p);
    if (i === -1) break;
    p = i + 8;
    if (i < 47) continue; // need room for primary/secondary UUIDs at -47/-43
    // Strict: name index in plausible range
    const firstIdx = buf.readUInt32LE(i + 8);
    if (firstIdx < 50 || firstIdx >= 50000) continue;
    // Require a trait count u16 within reasonable range at +298 (LAYOUT_A) or +294 (LAYOUT_B)
    // But also accept if traits are at +302 or +298 (alt layouts)
    let foundAge = -1;
    for (const ageOff of [26, 22, 30, 34]) {
      if (i + ageOff >= buf.length) continue;
      const age = 242 - buf[i + ageOff];
      if (age >= 14 && age <= 100) { foundAge = ageOff; break; }
    }
    if (foundAge < 0) continue;
    // Look for secondary UUID at -43
    const secUuid = buf.readUInt32LE(i - 43);
    if (secUuid === 0 || secUuid === 0xffffffff) continue;
    records.push({ off: i, nameIdx: firstIdx, ageOff: foundAge, secUuid });
  }
  return records;
}

const t3rec = findCharacterRecords(T3);
const t4rec = findCharacterRecords(T4);
console.log('T3 character records (loose): ' + t3rec.length);
console.log('T4 character records (loose): ' + t4rec.length + ' (diff=' + (t4rec.length - t3rec.length) + ')');

const t3uuid = new Map();
for (const r of t3rec) t3uuid.set(r.secUuid, r);
const t4uuid = new Map();
for (const r of t4rec) t4uuid.set(r.secUuid, r);

const newInT4 = [...t4uuid.keys()].filter(u => !t3uuid.has(u));
const removedFromT3 = [...t3uuid.keys()].filter(u => !t4uuid.has(u));
console.log('\nUUIDs new in T4: ' + newInT4.length);
console.log('UUIDs removed from T3: ' + removedFromT3.length);

if (newInT4.length > 0) {
  console.log('\nFirst 5 NEW UUIDs:');
  for (const u of newInT4.slice(0, 5)) {
    const r = t4uuid.get(u);
    console.log('  uuid=0x' + u.toString(16) + ' @ 0x' + r.off.toString(16) + ' nameIdx=' + r.nameIdx);
  }
}

// For SHARED uuids, find which one had a u32 field change from empty → UUID
console.log('\n=== Shared character records: u32 field that flipped empty→UUID ===');
const shared = [...t3uuid.keys()].filter(u => t4uuid.has(u));
console.log('  Shared: ' + shared.length);
let hits = 0;
for (const u of shared) {
  if (hits > 30) break;
  const r3 = t3uuid.get(u);
  const r4 = t4uuid.get(u);
  for (let dx = -50; dx < 300; dx += 1) {
    if (r3.off + dx < 0 || r3.off + dx + 4 > T3.length) continue;
    if (r4.off + dx < 0 || r4.off + dx + 4 > T4.length) continue;
    const v3 = T3.readUInt32LE(r3.off + dx);
    const v4 = T4.readUInt32LE(r4.off + dx);
    if (v3 === v4) continue;
    const wasEmpty = (v3 === 0 || v3 === 0xffffffff);
    const nowFilled = (v4 !== 0 && v4 !== 0xffffffff && v4 > 0x10000);
    if (!wasEmpty || !nowFilled) continue;
    // Check if v4 matches ANOTHER character's UUID (= it's a spouse pointer)
    const isCharUuid = t4uuid.has(v4);
    if (isCharUuid) {
      const target = t4uuid.get(v4);
      console.log('  char uuid=0x' + u.toString(16) + ' @ 0x' + r3.off.toString(16) +
        '  field +' + dx + ' empty→0x' + v4.toString(16) +
        '  →points to char @ 0x' + target.off.toString(16));
      hits++;
    }
  }
}
console.log('\nTotal "empty→character-UUID" hits: ' + hits);
