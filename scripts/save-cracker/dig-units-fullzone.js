// Scan the WHOLE save 0x37000..end for all unit records.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

// Find all ASCII unit-type strings in the file (after settlements)
const TYPE_STRINGS = [];
let p = 0x37000;
while (p < buf.length) {
  const c = buf[p];
  if (c < 0x20 || c > 0x7e) { p++; continue; }
  let q = p;
  while (q < buf.length && buf[q] >= 0x20 && buf[q] <= 0x7e) q++;
  const len = q - p;
  if (len >= 6 && len <= 50) {
    const s = buf.slice(p, q).toString('latin1');
    if (/^[a-zA-Z][a-zA-Z_0-9 ]+$/.test(s) && s.includes(' ')) {
      // Filter out building names (no space) and region names (UTF-16, not ASCII)
      // Unit types always have spaces
      TYPE_STRINGS.push({ off: p, str: s });
    }
  }
  p = q + 1;
}

console.log('Total unit-type strings 0x37000..end: ' + TYPE_STRINGS.length);

// Histogram
const typeCount = {};
for (const t of TYPE_STRINGS) typeCount[t.str] = (typeCount[t.str] || 0) + 1;
const sortedTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
console.log('\n=== Total distinct unit types: ' + sortedTypes.length + ' ===');
console.log('Top 30:');
for (const [name, n] of sortedTypes.slice(0, 30)) {
  console.log('  ' + String(n).padStart(3) + '× "' + name + '"');
}

// Spain-specific units (search for "spanish", "iberian", or units stationed in Spain regions)
const SPAIN_REGIONS = ['Hispania', 'Lusitania', 'Gallaecia', 'Taraconenis'];
console.log('\n=== Spain-region unit assignments ===');
function findUtf16Pstr16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}
for (const region of SPAIN_REGIONS) {
  const hits = findUtf16Pstr16(buf, region);
  console.log('  ' + region + ': ' + hits.length + ' unit records');
  // For first few hits, find the ASCII unit type BEFORE
  for (const h of hits.slice(0, 5)) {
    // Look back up to 100 bytes for the most recent ASCII unit type
    let bestType = null;
    for (let back = 30; back < 100; back++) {
      const tryAt = h - back;
      if (tryAt < 0) break;
      // Check if there's an ASCII string ending around tryAt
      if (buf[tryAt] >= 0x20 && buf[tryAt] <= 0x7e) {
        // Find string start
        let start = tryAt;
        while (start > 0 && buf[start - 1] >= 0x20 && buf[start - 1] <= 0x7e) start--;
        let end = tryAt;
        while (end < buf.length && buf[end] >= 0x20 && buf[end] <= 0x7e) end++;
        const s = buf.slice(start, end).toString('latin1');
        if (s.includes(' ') && s.length >= 6 && /^[a-z]/.test(s)) {
          bestType = s;
          break;
        }
      }
    }
    console.log('    0x' + h.toString(16) + '  unit type: "' + (bestType || '???') + '"');
  }
}
