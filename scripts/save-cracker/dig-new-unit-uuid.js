// Find the new unit's own UUID (probably 31 54 b1 7c) in T4 saves
// and look for its soldier records.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T2_QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav'));
const T3 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 3.sav'));
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

const newUuid = Buffer.from([0x31, 0x54, 0xb1, 0x7c]);
function findAll(buf, m) {
  const positions = [];
  let p = 0;
  while (true) {
    const idx = buf.indexOf(m, p);
    if (idx === -1) break;
    positions.push(idx);
    p = idx + 1;
  }
  return positions;
}

console.log('UUID 31 54 b1 7c hits:');
console.log('  T2_QUEUE: ' + findAll(T2_QUEUE, newUuid).length);
console.log('  T3:       ' + findAll(T3, newUuid).length);
console.log('  T4:       ' + findAll(T4, newUuid).length);

// Also try the bodyguard UUID e4 3d 21 89 across all three
const oldUuid = Buffer.from([0xe4, 0x3d, 0x21, 0x89]);
console.log('\nUUID e4 3d 21 89 (bodyguard):');
console.log('  T2_QUEUE: ' + findAll(T2_QUEUE, oldUuid).length);
console.log('  T3:       ' + findAll(T3, oldUuid).length);
console.log('  T4:       ' + findAll(T4, oldUuid).length);

// Show context for new UUID hits in T4
const t4Hits = findAll(T4, newUuid);
console.log('\nT4 new-UUID hits with context:');
for (const h of t4Hits.slice(0, 8)) {
  console.log('\n  @ 0x' + h.toString(16) + ':');
  for (let j = -16; j <= 32; j += 16) {
    const hex = Array.from(T4.slice(h + j, h + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T4.slice(h + j, h + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    const mark = j === 0 ? '  ← UUID' : '';
    console.log('    ' + (j >= 0 ? '+' : '') + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|' + mark);
  }
}

// Also look for clusters of any UUID-like 4-byte runs near the new unit (0x154ac1a)
// Maybe soldiers are stored at fixed offsets relative to the unit record
console.log('\n=== T4 bytes around 0x154ac1a (unit record) ===');
for (let off = 0x154ab00; off < 0x154ad80; off += 32) {
  const hex = Array.from(T4.slice(off, off + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(T4.slice(off, off + 32)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  0x' + off.toString(16) + ': ' + hex + '  |' + ascii + '|');
}
