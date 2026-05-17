// Analyze 0x4800-0x5400 — these UUID-records might be character family relationships.
// 21 starting playable factions, ~5-10 starting characters each = 100-200 characters total.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// Look for pattern: small ints (1-7) followed by UUID followed by small ints
// each record seems to be ~16-32 bytes
console.log('=== Bytes 0x4800-0x4900 ===');
for (let p = 0x4800; p < 0x4900; p += 32) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 32));
}

// Count u32 values in 0x4800-0x5400 and find clusters
const allU32 = [];
for (let off = 0x4800; off < 0x5400; off += 4) {
  allU32.push({ off, v: buf.readUInt32LE(off) });
}

// Find the small-int "type" field values that appear most often
const typeCounts = {};
for (const x of allU32) {
  if (x.v < 20) {
    typeCounts[x.v] = (typeCounts[x.v] || 0) + 1;
  }
}
console.log('\n=== Small int (<20) histogram ===');
for (const [k, v] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k + ': ' + v);
}

// The pattern looks like: [01 02 00 00 00] markers + UUID + small int + ...
// Find all "01 02 00 00 00" markers (record start?)
console.log('\n=== Markers "01 02 00 00 00" in 0x4800-0x5400 ===');
let p = 0x4800;
const markers = [];
while (p < 0x5400 - 5) {
  if (buf[p] === 1 && buf[p+1] === 2 && buf[p+2] === 0 && buf[p+3] === 0 && buf[p+4] === 0) {
    markers.push(p);
  }
  p++;
}
console.log('Total markers: ' + markers.length);
console.log('First 30: ' + markers.slice(0, 30).map(m => '0x' + m.toString(16)).join(', '));

// Compute strides
console.log('\n=== Strides between markers ===');
const strides = {};
for (let i = 1; i < markers.length; i++) {
  const d = markers[i] - markers[i-1];
  strides[d] = (strides[d] || 0) + 1;
}
for (const [k, v] of Object.entries(strides).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log('  stride ' + k + ': ' + v + ' times');
}

// Each marker followed by UUID - show first 8 records
console.log('\n=== First 6 marker records ===');
for (const m of markers.slice(0, 6)) {
  console.log('  0x' + m.toString(16) + ':');
  console.log('    +0:  ' + hex(m, 32));
  console.log('    +32: ' + hex(m + 32, 32));
}
