// Search the 148-byte pre-marker zone of each major-record for character
// UUIDs that match a known character. If found, that pins the faction's
// leader/diplomats, which gives us the faction NAME via the character's
// firstName/lastName lookup elsewhere.

const fs = require('fs');

const SAVES = [
  ['halo_oneman', 'C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav'],
  ['save_10_fresh', 'C:\\dev\\Provincia\\scripts\\save-cracker\\fixtures\\feral\\save_10_fresh.sav'],
];

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

// All character UUIDs (from the `ef 00 00 00 <uuid>` metadata records,
// any class, not just "general"). Returns Map<uuid, className>.
function findAllCharUuids(buf) {
  const out = new Map();
  const CHAR_CLASS_RE = /\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i;
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
      if (CHAR_CLASS_RE.test(s) && /^[a-z][a-z _0-9]*[a-z0-9]$/i.test(s)) {
        className = s; break;
      }
    }
    if (className) out.set(uuid, className);
  }
  return out;
}

for (const [tag, p] of SAVES) {
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const majors = findMajors(buf);
  const charUuids = findAllCharUuids(buf);
  console.log('\n=== ' + tag + ' — ' + majors.length + ' majors, ' + charUuids.size + ' chars ===');

  // For each major, scan the pre-marker zone +(92+4N+4) to +(244+4N) for
  // u32 values that match a known character UUID.
  let matchedMajors = 0;
  for (let k = 0; k < majors.length; k++) {
    const m = majors[k];
    const N = m.regionCount;
    const zoneStart = m.pos + 92 + 4 * N + 4;
    const zoneEnd = m.pos + 244 + 4 * N;
    if (zoneEnd > buf.length || zoneStart >= zoneEnd) continue;
    const hits = [];
    for (let off = zoneStart; off + 4 <= zoneEnd; off++) {
      const v = buf.readUInt32LE(off);
      if (charUuids.has(v)) {
        hits.push({ pos: off, relOff: off - m.pos, uuid: v, className: charUuids.get(v) });
      }
    }
    if (hits.length > 0) matchedMajors++;
    console.log('\nmajor[' + k + '] tag=0x' + m.factionTag.toString(16).padStart(8, '0') + '  regions=' + N + '  pre-marker zone +' + (92+4*N+4) + '..+' + (244+4*N) + ' (' + (244+4*N - (92+4*N+4)) + ' bytes)');
    if (hits.length === 0) {
      console.log('  NO character-UUID hits in pre-marker zone');
    } else {
      for (const h of hits) {
        console.log('  +0x' + h.relOff.toString(16) + ' (rel-to-marker-zone +' + (h.pos - zoneStart) + ')  uuid=0x' + h.uuid.toString(16).padStart(8, '0') + '  class="' + h.className + '"');
      }
    }
  }
  console.log('\n' + tag + ': ' + matchedMajors + '/' + majors.length + ' majors have at least one character-UUID hit in pre-marker zone');
}
