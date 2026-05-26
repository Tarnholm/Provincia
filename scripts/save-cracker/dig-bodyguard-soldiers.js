// Find the BODYGUARD unit's soldier array in T4 and compare to the fresh-recruit
// soldiers (all zeros) to identify which byte is weapon/armor/exp.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T4 = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 4.sav'));

// Bodyguard UUID hit at 0x1537af5. Dump around it to find the soldier array.
console.log('=== Bytes around bodyguard UUID hit 0x1537af5 in T4 ===');
for (let off = 0x1537a00; off < 0x1538800; off += 32) {
  const hex = Array.from(T4.slice(off, off + 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(T4.slice(off, off + 32)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('0x' + off.toString(16) + ': ' + hex + '  |' + ascii + '|');
}
