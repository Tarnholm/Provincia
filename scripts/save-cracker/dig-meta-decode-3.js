// Side-by-side dump of 4 metadata records (Gnaeus + 3 greek) to visually
// determine the actual layout after the ASCII class string.

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
    out.push({ off: i, uuid, className: classStr, classEnd });
  }
  return out;
}

const recs = findAllRecs(A);

// Helper: extract region string starting from classEnd. Returns the byte
// offset where the UTF-16 pstr16 starts.
function findRegionStart(buf, classEnd) {
  for (let p = classEnd; p < classEnd + 80; p++) {
    const lenChars = buf.readUInt16LE(p);
    if (lenChars < 3 || lenChars > 40) continue;
    if (p + 2 + lenChars * 2 > buf.length) continue;
    let ok = true;
    const chars = [];
    for (let j = 0; j < lenChars; j++) {
      const c = buf.readUInt16LE(p + 2 + j * 2);
      if (c < 0x20 || c > 0x7e) { ok = false; break; }
      chars.push(String.fromCharCode(c));
    }
    if (ok && /^[A-Z][A-Za-z _0-9-]*$/.test(chars.join(''))) return { off: p, str: chars.join('') };
  }
  return null;
}

const samples = [
  recs.find(r => r.className === 'roman general'),                                 // Gnaeus
  recs.find(r => r.className === 'greek general' && r.uuid === 0xae651057),        // Akarnania
  recs.find(r => r.className === 'greek general' && r.uuid === 0xefcfd38f),        // Akragas
  recs.find(r => r.className === 'seleucid general' && r.uuid === 0xbe5c31a3),     // Dorylaia
];

function hex(buf, off, n) {
  return Array.from(buf.subarray(off, off + n)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

for (const s of samples) {
  if (!s) { console.log('SKIP: missing sample'); continue; }
  const reg = findRegionStart(A, s.classEnd);
  console.log('\n=== ' + s.className + ' uuid=0x' + s.uuid.toString(16).padStart(8, '0') + ' ===');
  console.log('  classEnd at file 0x' + s.classEnd.toString(16) + '  region "' + (reg ? reg.str : '?') + '" starts at file 0x' + (reg ? reg.off : -1).toString(16));
  console.log('  byte-from-classEnd→regionStart offset = ' + (reg ? reg.off - s.classEnd : '?'));
  console.log('  Bytes from classEnd-2 to regionStart+10:');
  console.log('   relOff  abs       hex                                           ascii');
  const startAbs = s.classEnd - 2;
  const endAbs = (reg ? reg.off : s.classEnd + 30) + 10;
  for (let off = startAbs; off < endAbs; off += 8) {
    const reloff = off - s.classEnd;
    const bytes = A.subarray(off, off + 8);
    const h = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(bytes).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = (off >= s.classEnd && off < s.classEnd + 4) ? ' <classEnd>' :
                 (reg && off >= reg.off && off < reg.off + 4) ? ' <region>' : '';
    console.log('   ' + (reloff >= 0 ? '+' : '') + reloff.toString().padStart(3) +
                '  0x' + off.toString(16).padStart(7, '0') +
                '  ' + h.padEnd(24) + '  ' + asc + mark);
  }
  // Read u32 values at classEnd + 0..20
  console.log('  u32-aligned reads from classEnd:');
  for (let off = 0; off < 24; off += 4) {
    const v = A.readUInt32LE(s.classEnd + off);
    console.log('    classEnd+' + off.toString().padStart(2) + ': 0x' + v.toString(16).padStart(8, '0'));
  }
}

// Hypothesis: there might be 1-byte padding after the class string null.
// Let's check: read u32 at classEnd+1 (off by one) instead.
console.log('\n=== Test: u32 reads at classEnd+1, +5, +9, ... (off-by-one alignment) ===');
for (const s of samples) {
  if (!s) continue;
  console.log(s.className.padEnd(20) + ' uuid=0x' + s.uuid.toString(16).padStart(8, '0'));
  for (let off = 1; off < 22; off += 4) {
    const v = A.readUInt32LE(s.classEnd + off);
    console.log('  classEnd+' + off.toString().padStart(2) + ': 0x' + v.toString(16).padStart(8, '0'));
  }
}
