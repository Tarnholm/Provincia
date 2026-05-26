// Find all pstr16 ASCII role-like strings in Spain T1

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T1 = fs.readFileSync(path.join(BASE_R, 'save_17-05-2026   Spain   Turn 1.sav'));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 4 || lenP1 > 50) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Scan for two-word lowercase strings (likely roles)
const seen = new Set();
const strings = [];
for (let p = 0; p < T1.length - 4; p++) {
  const r = readPstr16Asciiz(T1, p);
  if (!r) continue;
  if (r.str.includes(' ') && /^[a-z][a-z _]+$/.test(r.str)) {
    if (!seen.has(r.str)) {
      seen.add(r.str);
      strings.push({ str: r.str, firstOff: p });
    }
    p += r.totalLen - 1;
  }
}

console.log('Unique multi-word lowercase strings in Spain T1: ' + strings.length);
// Filter to role-shaped strings
const roleLike = strings.filter(s => s.str.split(' ').length <= 3 && s.str.length < 30);
console.log('\nRole-like strings (≤3 words, <30 chars):');
for (const s of roleLike.slice(0, 100)) {
  console.log('  "' + s.str + '"  first @ 0x' + s.firstOff.toString(16));
}
