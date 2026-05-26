// Extended walker — go FAR past Epidamnus to capture all buildings + check
// if there's a hidden temple / smith / gymnasium beyond the 3rd default_set
// that grants unit upgrades.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T11 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

// Walk a HUGE range past Epidamnus, allowing all-letter strings (4+ chars)
function exhaustiveWalk(buf, label) {
  const epi = findUtf16(buf, 'Epidamnus');
  console.log('\n=== ' + label + ' Epidamnus@0x' + epi.toString(16) + ' ===');

  // Walk 8000 bytes after Epidamnus name
  let p = epi + 20;  // Past "Epidamnus" UTF-16 (9 chars + null = 20 bytes)
  const end = Math.min(epi + 8000, buf.length - 4);

  const allFinds = [];
  let lastDsAt = -1;
  while (p < end) {
    const r = readPstr16Asciiz(buf, p);
    if (!r) { p++; continue; }
    if (!/^[a-z_][a-z_0-9]*$/.test(r.str)) { p++; continue; }
    if (r.str.length < 3) { p++; continue; }
    allFinds.push({ off: p, str: r.str, len: r.totalLen });
    p += r.totalLen;
  }

  // Look for unique buildings (skip culture_general dupes/markers)
  console.log('All pstr16 strings (off, name):');
  for (const f of allFinds) {
    const marker = f.str === 'default_set' ? '   <<< DEFAULT_SET MARKER >>>' : '';
    console.log('  0x' + f.off.toString(16).padStart(6) + '  ' + f.str + marker);
  }

  return allFinds;
}

const a11 = exhaustiveWalk(T11, 'T11 enslaved');
const a12 = exhaustiveWalk(T12, 'T12 retrained');

// Diff:
console.log('\n=== Strings in T12 NOT in T11 ===');
const t11Strs = new Set(a11.map(f => f.str));
for (const f of a12) {
  if (!t11Strs.has(f.str)) console.log('  T12 only: ' + f.str + ' @ 0x' + f.off.toString(16));
}
console.log('\n=== Strings in T11 NOT in T12 ===');
const t12Strs = new Set(a12.map(f => f.str));
for (const f of a11) {
  if (!t12Strs.has(f.str)) console.log('  T11 only: ' + f.str + ' @ 0x' + f.off.toString(16));
}
