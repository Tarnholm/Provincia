// Decode the ~1000 bytes of state inside each unit record.
// After [type_ascii][location_pstr16] we have stats: soldier count, experience, etc.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

// Find unit records
const UNITS = [];
let p = 0x37000;
while (p < buf.length) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 6 && len <= 50) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s) && s.includes(' ') && s[0] === s[0].toLowerCase()) {
      // Read the location pstr16 after the type
      const afterType = p + len;
      let locOff = afterType;
      // Skip bytes until we find a valid pstr16 UTF-16
      let locRec = null;
      for (let skip = 0; skip < 30; skip++) {
        const r = readPstr16Utf16(buf, afterType + skip);
        if (r && r.str.length >= 3) {
          locOff = afterType + skip;
          locRec = r;
          break;
        }
      }
      UNITS.push({ off: p, type: s, typeLen: len, locOff, locRec });
    }
  }
  p = q + 1;
}

console.log('Total units: ' + UNITS.length);

// For each unit, look at the bytes AFTER the location pstr16
// Look for plausible stats: soldier count (0-240), experience (0-9), morale (0-100)
console.log('\n=== Dump first 80 bytes after location for 5 units ===');
function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
for (const u of UNITS.slice(0, 5)) {
  if (!u.locRec) continue;
  console.log('\n' + u.type + ' @ "' + u.locRec.str + '" (record at 0x' + u.off.toString(16) + '):');
  const stateStart = u.locOff + u.locRec.totalLen;
  console.log('  state starts at 0x' + stateStart.toString(16));
  console.log('  +0:  ' + hex(stateStart, 16));
  console.log('  +16: ' + hex(stateStart + 16, 16));
  console.log('  +32: ' + hex(stateStart + 32, 16));
  console.log('  +48: ' + hex(stateStart + 48, 16));
  console.log('  +64: ' + hex(stateStart + 64, 16));

  // u32/u16 fields
  for (let i = 0; i < 16; i++) {
    const u32 = buf.readUInt32LE(stateStart + i * 4);
    if (u32 > 0 && u32 < 10000) {
      console.log('    u32@+' + (i*4) + ': ' + u32);
    }
  }
}

// Find fields where most units have small integer values (soldier count, experience, etc.)
console.log('\n=== Fields where 80%+ of units have values 0-300 (soldier-count-ish) ===');
for (let relOff = 0; relOff < 200; relOff += 4) {
  const vals = [];
  for (const u of UNITS) {
    if (!u.locRec) continue;
    const stateStart = u.locOff + u.locRec.totalLen;
    if (stateStart + relOff + 4 > buf.length) continue;
    vals.push(buf.readUInt32LE(stateStart + relOff));
  }
  const valid = vals.filter(v => v >= 0 && v <= 300);
  const ratio = valid.length / vals.length;
  if (ratio > 0.75) {
    // Show stats
    const unique = new Set(valid);
    console.log('  state+' + String(relOff).padStart(3) + ' (' + (ratio*100).toFixed(0) + '% small): unique=' + unique.size + ' samples=[' + valid.slice(0, 10).join(', ') + ']');
  }
}
