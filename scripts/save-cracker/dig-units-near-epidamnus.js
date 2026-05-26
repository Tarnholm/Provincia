// Search for ASCII unit-type strings near Epidamnus settlement record in T11 and T12.
// Macedonian cavalry units in Alexander EDU (export_descr_unit) include:
//   "greek cavalry", "macedonian cavalry", "companion cavalry", "thessalian cavalry"
// Plus infantry: "greek hoplites", "militia hoplites", "phalanx pikemen"

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const T11 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

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
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

function scanForUnitStrings(buf, startOff, endOff, label) {
  console.log('\n=== ' + label + ' scan 0x' + startOff.toString(16) + '..0x' + endOff.toString(16) + ' ===');
  const found = [];
  let p = startOff;
  while (p < endOff && p < buf.length - 4) {
    const r = readPstr16Asciiz(buf, p);
    if (r && r.str.length >= 4 && /^[a-z][a-z _]+$/.test(r.str)) {
      // Likely a unit type name (lowercase + space)
      found.push({ off: p, str: r.str });
      p += r.totalLen;
      continue;
    }
    p++;
  }
  // Filter: keep entries with spaces (multi-word unit names)
  const unitNames = found.filter(f => f.str.includes(' '));
  console.log('Multi-word strings (' + unitNames.length + '):');
  for (const u of unitNames.slice(0, 50)) {
    console.log('  0x' + u.off.toString(16) + '  "' + u.str + '"');
  }
  return unitNames;
}

const epi11 = findUtf16(T11, 'Epidamnus');
const epi12 = findUtf16(T12, 'Epidamnus');
console.log('Epidamnus T11 @ 0x' + epi11.toString(16) + ', T12 @ 0x' + epi12.toString(16));

// Scan a wide range BEFORE Epidamnus (units might be in a separate section)
// and AFTER Epidamnus
const a = scanForUnitStrings(T11, epi11 - 10000, epi11 + 30000, 'T11 around Epidamnus');
const b = scanForUnitStrings(T12, epi12 - 10000, epi12 + 30000, 'T12 around Epidamnus');

// Diff unit lists: anything in T12 not in T11 (newly retrained)?
const t11Set = new Set(a.map(x => x.str));
const t12NewStrs = b.filter(x => !t11Set.has(x.str));
console.log('\n=== Unit strings in T12 NOT in T11 (new retrains?) ===');
for (const u of t12NewStrs) console.log('  T12 only: 0x' + u.off.toString(16) + '  "' + u.str + '"');
