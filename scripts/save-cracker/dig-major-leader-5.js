// Check the 40-byte post-region-list zone (+52+4N..+92+4N) for leader
// character UUIDs in major records.

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
    records.push({ pos: i, regionCount: regions, factionTag: buf.readUInt32LE(i + 28) });
    i = Math.min(buf.length - 64, i + 92 + 4 * regions);
  }
  return records;
}

function findCharUuids(buf) {
  const out = new Map();
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let className = null;
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
        className = s; break;
      }
    }
    if (className) out.set(uuid, className);
  }
  return out;
}

const majors = findMajors(A);
const charUuids = findCharUuids(A);
console.log('Majors:', majors.length, '  Chars:', charUuids.size);

console.log('\n=== 40-byte post-region-list zone for each major ===\n');
for (let k = 0; k < majors.length; k++) {
  const m = majors[k];
  const N = m.regionCount;
  const zoneStart = m.pos + 52 + 4 * N;
  const zoneEnd = m.pos + 92 + 4 * N;

  console.log('major[' + k + '] tag=0x' + m.factionTag.toString(16).padStart(8, '0') + '  regions=' + N + '  zone=+' + (52+4*N) + '..+' + (92+4*N) + ' (40 bytes)');
  const bytes = A.subarray(zoneStart, zoneEnd);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const asc = Array.from(bytes).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  hex: ' + hex.substring(0, 60) + '...');
  console.log('  hex: ...' + hex.substring(60));
  console.log('  asc: ' + asc);

  // Check each u32 in this zone — is any a known character UUID?
  const hits = [];
  for (let off = 0; off + 4 <= 40; off++) {
    const v = A.readUInt32LE(zoneStart + off);
    if (charUuids.has(v)) {
      hits.push({ offFromZone: off, offFromRecord: 52 + 4 * N + off, uuid: v, className: charUuids.get(v) });
    }
  }
  if (hits.length > 0) {
    for (const h of hits) {
      console.log('  *** char-UUID hit at +' + h.offFromRecord + ': 0x' + h.uuid.toString(16).padStart(8, '0') + ' "' + h.className + '" ***');
    }
  }
  console.log();
}

// Tally: how many majors have at least one character-UUID hit in this zone?
let withHit = 0;
for (let k = 0; k < majors.length; k++) {
  const m = majors[k];
  const N = m.regionCount;
  const zoneStart = m.pos + 52 + 4 * N;
  for (let off = 0; off + 4 <= 40; off++) {
    const v = A.readUInt32LE(zoneStart + off);
    if (charUuids.has(v)) { withHit++; break; }
  }
}
console.log('=== ' + withHit + '/' + majors.length + ' majors have a char-UUID in post-region-list zone ===');
