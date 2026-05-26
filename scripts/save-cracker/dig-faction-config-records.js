// Decode faction-config records bracketed by 12 34 de 0a marker.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));

// Find all 12 34 de 0a markers in 0..0x4000
const marker = Buffer.from([0x12, 0x34, 0xde, 0x0a]);
const positions = [];
let p = 0;
while (true) {
  const idx = buf.indexOf(marker, p);
  if (idx === -1 || idx > 0x4000) break;
  positions.push(idx);
  p = idx + 1;
}
console.log('Found ' + positions.length + ' "12 34 de 0a" markers in 0..0x4000:');
for (const pos of positions.slice(0, 30)) console.log('  0x' + pos.toString(16));

// Compute gaps to identify record size
console.log('\nGaps between consecutive markers:');
for (let i = 1; i < Math.min(20, positions.length); i++) {
  console.log('  ' + i + ': 0x' + positions[i].toString(16) + ' - 0x' + positions[i-1].toString(16) + ' = ' + (positions[i] - positions[i-1]));
}

// Dump the first 5 records (between consecutive markers)
console.log('\n=== First 5 records (bytes between consecutive markers) ===');
for (let i = 0; i < Math.min(5, positions.length - 1); i++) {
  const start = positions[i];
  const end = positions[i + 1];
  const len = end - start;
  console.log('\nRecord ' + i + ' @ 0x' + start.toString(16) + ' (' + len + ' bytes):');
  for (let j = 0; j < len; j += 16) {
    const chunk = buf.slice(start + j, start + j + 16);
    const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
  }
}
