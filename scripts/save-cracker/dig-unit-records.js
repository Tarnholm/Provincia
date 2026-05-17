// Investigate the unit-records section starting at 0x100000.
// Each unit has its ASCII type name + ~1000 bytes of unit state.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Find all unit-type ASCII strings in 0x100000..end (length 6+ chars)
const TYPE_STRINGS = [];
let p = 0x100000;
while (p < buf.length) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 6 && len <= 50) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s) && s.includes(' ')) {  // unit types have spaces
      TYPE_STRINGS.push({ off: p, str: s });
    }
  }
  p = q + 1;
}

console.log('Total unit-type-like ASCII strings: ' + TYPE_STRINGS.length);
console.log('\n=== First 30 with strides ===');
for (let i = 0; i < 30 && i < TYPE_STRINGS.length; i++) {
  const t = TYPE_STRINGS[i];
  const stride = i > 0 ? t.off - TYPE_STRINGS[i-1].off : 0;
  console.log('  0x' + t.off.toString(16).padStart(6, '0') + ' (Δ' + stride + ' bytes): "' + t.str + '"');
}

// Histogram of unit-type names
const typeCount = {};
for (const t of TYPE_STRINGS) typeCount[t.str] = (typeCount[t.str] || 0) + 1;
const sortedTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
console.log('\n=== Top 20 most common unit types ===');
for (const [name, n] of sortedTypes.slice(0, 20)) {
  console.log('  ' + n + '× "' + name + '"');
}
console.log('\nTotal distinct types: ' + sortedTypes.length);

// Try to decode the first unit record (around the first type string)
console.log('\n=== First unit record context (around "numidian cavalry" at 0x100298) ===');
const firstOff = TYPE_STRINGS[0].off;
console.log('Bytes BEFORE the type name (-32..0):');
for (let row = -2; row <= 0; row++) {
  console.log('  0x' + (firstOff + row * 16).toString(16) + ': ' + hex(firstOff + row * 16, 16));
}
console.log('Type string starts at 0x' + firstOff.toString(16) + ' ("' + TYPE_STRINGS[0].str + '")');
console.log('Bytes AFTER the type name (string ends at +' + TYPE_STRINGS[0].str.length + '):');
const afterStr = firstOff + TYPE_STRINGS[0].str.length;
for (let row = 0; row < 5; row++) {
  console.log('  0x' + (afterStr + row * 16).toString(16) + ': ' + hex(afterStr + row * 16, 16));
}

// What unit types correspond to Spain? Look for "spanish" or "iberian"
console.log('\n=== Search for Spain-related unit types ===');
const spanishTypes = TYPE_STRINGS.filter(t => /spanish|iberian|spain/i.test(t.str));
for (const t of spanishTypes.slice(0, 10)) {
  console.log('  0x' + t.off.toString(16) + ': "' + t.str + '"');
}
console.log('Total Spain-related unit records: ' + spanishTypes.length);
