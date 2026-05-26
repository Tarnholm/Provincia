// Find ALL occurrences of "thessalian cavalry" (a Macedon unit) in T11 and T12,
// and diff their record bytes to find weapon/armor/experience fields.

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const T11 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));
const T12 = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 12 retrained and upgraded units.sav'));

function findPstr16Asciiz(buf, name) {
  // Build pstr16 bytes: u16 length+1 + name + null
  const lenP1 = name.length + 1;
  const target = Buffer.concat([
    Buffer.from([lenP1 & 0xff, (lenP1 >> 8) & 0xff]),
    Buffer.from(name, 'latin1'),
    Buffer.from([0])
  ]);
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(target, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

const t11Thes = findPstr16Asciiz(T11, 'thessalian cavalry');
const t12Thes = findPstr16Asciiz(T12, 'thessalian cavalry');
console.log('T11 "thessalian cavalry" positions: ' + t11Thes.length);
for (const p of t11Thes) console.log('  0x' + p.toString(16));
console.log('T12 "thessalian cavalry" positions: ' + t12Thes.length);
for (const p of t12Thes) console.log('  0x' + p.toString(16));

// For each, dump the surrounding 80 bytes
for (let i = 0; i < Math.min(t11Thes.length, 3); i++) {
  const off11 = t11Thes[i];
  console.log('\n=== T11 "thessalian cavalry" #' + (i+1) + ' @ 0x' + off11.toString(16) + ' ===');
  // Show 80 bytes around
  const after = off11 + 22; // skip pstr16 header + name (18 chars + null = 19 + 2 hdr = 21, round to 22)
  console.log('Bytes following the name string:');
  for (let j = 0; j < 80; j += 16) {
    const hex = Array.from(T11.slice(after + j, after + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T11.slice(after + j, after + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(2) + ': ' + hex + '  |' + ascii + '|');
  }
}

// Diff each pair (T11 has more, so iterate over T12 since fewer occurrences)
// Match by INDEX — assume T11[i] corresponds to T12[i]
const matchCount = Math.min(t11Thes.length, t12Thes.length);
console.log('\n=== Byte diffs in 80-byte trailer (T11 vs T12) ===');
for (let i = 0; i < matchCount; i++) {
  const o11 = t11Thes[i] + 22;  // after pstr16
  const o12 = t12Thes[i] + 22;
  console.log('\nPair ' + i + ': T11@0x' + t11Thes[i].toString(16) + '  T12@0x' + t12Thes[i].toString(16));
  for (let j = 0; j < 80; j++) {
    const a = T11[o11 + j];
    const b = T12[o12 + j];
    if (a !== b) {
      console.log('  +' + j.toString().padStart(2) + ': T11=' + a.toString().padStart(3) + ' T12=' + b.toString().padStart(3) + '  Δ=' + (b - a));
    }
  }
}
