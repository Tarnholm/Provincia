// Explore the 820 KB gap between settlements (end ~0x37000) and unit records
// (start 0x100000). This is where per-faction records with treasury might live.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 1. ASCII strings in the gap
console.log('=== ASCII strings in 0x37000..0x100000 (4+ chars) ===');
let p = 0x37000;
let hits = 0;
while (p < 0x100000 && hits < 80) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 6) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16) + ' (' + len + '): "' + s + '"');
      hits++;
    }
  }
  p = q + 1;
}

// 2. UTF-16 pstr16 strings
console.log('\n=== UTF-16 pstr16 strings in 0x37000..0x100000 (4+ chars) ===');
p = 0x37000;
hits = 0;
while (p < 0x100000 && hits < 80) {
  if (p + 2 > buf.length) break;
  const slen = buf.readUInt16LE(p);
  if (slen < 4 || slen > 30) { p++; continue; }
  if (p + 2 + slen * 2 > buf.length) { p++; continue; }
  let allPrintable = true;
  const chars = [];
  for (let i = 0; i < slen; i++) {
    const c = buf.readUInt16LE(p + 2 + i * 2);
    if (c < 0x20 || c > 0x7e) { allPrintable = false; break; }
    chars.push(String.fromCharCode(c));
  }
  if (allPrintable) {
    const s = chars.join('');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s)) {
      console.log('  0x' + p.toString(16) + ' pstr16(' + slen + '): "' + s + '"');
      hits++;
      p += 2 + slen * 2;
      continue;
    }
  }
  p++;
}

// 3. Look for 0x15 section tags (universal RTW section marker)
console.log('\n=== 0x15 00 00 00 section tags in 0x37000..0x100000 ===');
const sectionTag = Buffer.from([0x15, 0x00, 0x00, 0x00]);
hits = 0;
let pos = 0x37000;
while ((pos = buf.indexOf(sectionTag, pos)) !== -1 && pos < 0x100000 && hits < 60) {
  // Verify this looks like a section tag (preceded by ffffffff often)
  const prev4 = pos >= 4 ? buf.readUInt32LE(pos - 4) : 0;
  const next4 = pos + 4 + 4 <= buf.length ? buf.readUInt32LE(pos + 4) : 0;
  console.log('  0x' + pos.toString(16) + '  prev_u32=' + prev4 + ' next_u32=' + next4);
  hits++;
  pos += 4;
}
