// Find religion bytes specifically NEAR Epidamnus settlement record
// and confirm offset by looking at multiple settlements at the same relative position.

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE_A, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

function findUtf16All(buf, str, fromOff) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  const positions = [];
  let p = fromOff || 0;
  while (true) {
    const idx = buf.indexOf(target, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

// Find ALL settlement names — using a broader list of known Alexander settlements
const knownSettlements = [
  'Pella', 'Larissa', 'Athens', 'Sparta', 'Thermon', 'Halicarnassus', 'Sardis',
  'Tarsus', 'Antioch', 'Damascus', 'Tyre', 'Jerusalem', 'Gaza', 'Pelusium', 'Memphis', 'Alexandria',
  'Thebes', 'Ecbatana', 'Susa', 'Persepolis', 'Babylon', 'Ur', 'Arbela', 'Bactra', 'Maracanda',
  'Drapsaca', 'Alexandropolis', 'Taxila', 'Pattala', 'Epidamnus', 'Apollonia', 'Pelium',
  'Byzantium', 'Sestus', 'Sigeum', 'Mazaca', 'Nineveh', 'Pasargadae', 'Nisibis',
  'Tyana', 'Edessa', 'Issus', 'Aornus', 'Cilicia', 'Cyrene', 'Naucratis'
];

const settlementOffs = [];
for (const name of knownSettlements) {
  const positions = findUtf16All(SAVE, name);
  for (const p of positions) settlementOffs.push({ name, off: p });
}
settlementOffs.sort((a, b) => a.off - b.off);

console.log('Found ' + settlementOffs.length + ' settlement name occurrences:');
for (const s of settlementOffs) console.log('  0x' + s.off.toString(16) + '  ' + s.name);

// For each settlement, scan +0..+2000 from name for a 6-byte religion pattern
// where the bytes are all in [0,100] and sum is 95-105.
console.log('\n=== Religion patterns within 2000 bytes after each settlement name ===');
for (const s of settlementOffs) {
  for (let dx = 0; dx < 2000; dx++) {
    const off = s.off + dx;
    let sum = 0;
    let valid = true;
    for (let i = 0; i < 6; i++) {
      const b = SAVE[off + i];
      if (b > 100) { valid = false; break; }
      sum += b;
    }
    if (valid && sum >= 95 && sum <= 105) {
      // First valid window — record and break
      const bytes = Array.from(SAVE.slice(off, off + 6));
      const relOff = off - s.off;
      console.log('  ' + s.name.padEnd(15) + ' @0x' + s.off.toString(16) +
        '  religion@+' + relOff + ' (0x' + relOff.toString(16) + ')' +
        '  sum=' + sum + ' [' + bytes.join(',') + ']');
      break;
    }
  }
}

// Now check the OPPOSITE — for each settlement, scan -2000..0 BEFORE its name
console.log('\n=== Religion patterns within 2000 bytes BEFORE each settlement name ===');
for (const s of settlementOffs) {
  for (let dx = -2000; dx < 0; dx++) {
    const off = s.off + dx;
    let sum = 0;
    let valid = true;
    for (let i = 0; i < 6; i++) {
      const b = SAVE[off + i];
      if (b > 100) { valid = false; break; }
      sum += b;
    }
    if (valid && sum >= 95 && sum <= 105) {
      const bytes = Array.from(SAVE.slice(off, off + 6));
      // Only show patterns with at least 3 non-zero bytes (mixed religion)
      const nonZero = bytes.filter(b => b > 0).length;
      if (nonZero >= 3) {
        const relOff = off - s.off;
        console.log('  ' + s.name.padEnd(15) + ' @0x' + s.off.toString(16) +
          '  religion@' + relOff + ' (' + relOff.toString(16) + ')' +
          '  sum=' + sum + ' [' + bytes.join(',') + ']');
        break;
      }
    }
  }
}
