// Session 111 — re-do the metadata-record faction-UUID hunt with the
// class-string-end as anchor (the class string is variable length, so
// fixed-from-record-start offsets don't line up post-string).

const fs = require('fs');

const A = fs.readFileSync('C:\\Users\\vtarn\\Downloads\\save_halo_oneman.sav..sav');

function findAllRecs(buf) {
  const CHAR_CLASS_RE = /\b(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)\b/i;
  const out = [];
  for (let i = 0; i < buf.length - 64; i++) {
    if (buf.readUInt32LE(i) !== 0xef) continue;
    const uuid = buf.readUInt32LE(i + 4);
    if (!uuid || uuid === 0xffffffff) continue;
    let classStr = null, classEnd = -1;
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
        classStr = s;
        classEnd = p + 2 + lenP1;
        break;
      }
    }
    if (!classStr) continue;
    // Faction word from class string
    const m = classStr.match(/^(.*?)\s+(general|captain|admiral|diplomat|spy|assassin|merchant|princess|priest)$/i);
    const factionWord = m ? m[1].toLowerCase().replace(/\s+/g, '_') : '?';
    out.push({ off: i, uuid, className: classStr, classEnd, factionWord });
  }
  return out;
}

const allRecs = findAllRecs(A);
console.log('Total char metadata records:', allRecs.length);

const byFaction = new Map();
for (const r of allRecs) {
  if (!byFaction.has(r.factionWord)) byFaction.set(r.factionWord, []);
  byFaction.get(r.factionWord).push(r);
}
const sorted = Array.from(byFaction.entries()).sort((a, b) => b[1].length - a[1].length);

console.log('\n=== u32 values at offset N from CLASS-STRING-END, comparing same-faction chars ===\n');

for (const [fw, list] of sorted) {
  if (list.length < 2) continue;
  console.log('Faction "' + fw + '" (' + list.length + ' chars):');
  // For each offset 0..100 from classEnd, gather u32 values
  for (let off = 0; off <= 100; off += 1) {
    const vals = new Set();
    let ok = true;
    for (const r of list) {
      const pos = r.classEnd + off;
      if (pos + 4 > A.length) { ok = false; break; }
      vals.add(A.readUInt32LE(pos));
    }
    if (!ok) continue;
    if (vals.size === 1) {
      const v = Array.from(vals)[0];
      // Filter: not 0, not constant, not self-pointer-like, not small int
      if (v === 0 || v === 0xffffffff || v === 1 || v === 100 || v === 0x00010000) continue;
      // Mark as INTERESTING if it looks UUID-like (high bits set, non-trivial)
      const isUuid = v > 0x01000000 && v < 0xff000000;
      console.log('  classEnd+' + off.toString().padStart(3) + ' (' + off + '): u32 = 0x' + v.toString(16).padStart(8, '0') + ' (' + v + ')' + (isUuid ? '  <-- UUID-like' : ''));
    }
  }
  // Print sample u32s for the first character in the list
  const r0 = list[0];
  console.log('  Sample u32s @ classEnd of first char (uuid=0x' + r0.uuid.toString(16) + '):');
  for (let off = 0; off <= 32; off += 4) {
    console.log('    +' + off.toString().padStart(2) + ': 0x' + A.readUInt32LE(r0.classEnd + off).toString(16).padStart(8, '0'));
  }
  console.log();
}
