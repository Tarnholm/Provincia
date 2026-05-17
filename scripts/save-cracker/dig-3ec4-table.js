// 68-entry run of u32 values 0-25 starting at 0x3ec4. Investigate.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE).filter(f => f.endsWith('.sav') && f.includes('Spain'));
const T_FILES = {};
for (const f of allFiles) {
  for (const t of [1, 2, 3, 4]) {
    if (f.includes('Turn ' + t)) {
      if (!T_FILES[t]) T_FILES[t] = fs.readFileSync(path.join(BASE, f));
      break;
    }
  }
}
const buf = T_FILES[4];

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

console.log('=== Bytes 0x3ec0..0x4100 ===');
for (let p = 0x3ec0; p < 0x4100; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}

// Read the 68 u32 values starting at 0x3ec4
console.log('\n=== 68 u32 values at 0x3ec4 (stride 4) ===');
const vals = [];
for (let i = 0; i < 68; i++) {
  vals.push(buf.readUInt32LE(0x3ec4 + i * 4));
}
console.log('  ' + vals.join(', '));

// Distribution
const counts = {};
for (const v of vals) counts[v] = (counts[v] || 0) + 1;
console.log('\n=== Distribution ===');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + k + ': ' + v);
}

// Compare across T1→T4
console.log('\n=== Compare T1→T4 values at 0x3ec4 ===');
let changed = 0;
for (let i = 0; i < 68; i++) {
  const off = 0x3ec4 + i * 4;
  const v1 = T_FILES[1].readUInt32LE(off);
  const v4 = T_FILES[4].readUInt32LE(off);
  if (v1 !== v4) {
    console.log('  +' + i + ' (0x' + off.toString(16) + '): T1=' + v1 + ' T4=' + v4);
    changed++;
  }
}
console.log('Total changed positions: ' + changed);

// Also check stride-8 (alternating u32 might be a paired list)
console.log('\n=== Stride-8 interpretation (pairs of u32) ===');
for (let i = 0; i < 34; i++) {
  const a = buf.readUInt32LE(0x3ec4 + i * 8);
  const b = buf.readUInt32LE(0x3ec4 + i * 8 + 4);
  console.log('  pair[' + i + ']: a=' + a + ' b=' + b);
}
