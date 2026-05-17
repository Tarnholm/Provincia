const fs = require('fs');
const path = require('path');
const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));
function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}
console.log('Around 0x19b30 (inside Arretium settlement record):');
for (let row = -4; row <= 4; row++) {
  const addr = 0x19b30 + row * 16;
  console.log('  0x' + addr.toString(16) + ': ' + hex(addr, 16) + (row === 0 ? '  <- 1201/1276 here at +0' : ''));
}
// Arretium starts at 0x19b16 (UTF-16 name pstr16 strlen).
// Name "Arretium" = 8 chars = 16 UTF-16 bytes, plus 2-byte length = 18 bytes total
// So name ends at 0x19b16 + 18 = 0x19b28
// 0x19b30 is 8 bytes after name end — inside the 18-byte gap before "default_set"
console.log('\nArretium name ends at 0x19b28. 0x19b30 = +8 bytes after name end.');
console.log('At 0x19b30 we have u32 = ' + buf.readUInt32LE(0x19b30) + ' (potentially settlement field)');
