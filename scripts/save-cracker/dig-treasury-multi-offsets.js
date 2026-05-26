// Check treasury offset candidates 0x2c094, 0x2c14c, 0x2c5e1 across ALL Spain saves

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const allFiles = fs.readdirSync(BASE_R).filter(f => f.endsWith('.sav') && f.includes('Spain'));

const OFFSETS = [0x2c094, 0x2c14c, 0x2c5e1];

console.log('Spain treasury candidate values across all saves:');
console.log('save                                                  | 0x2c094  | 0x2c14c  | 0x2c5e1  | file size');
for (const f of allFiles) {
  const buf = fs.readFileSync(path.join(BASE_R, f));
  const vals = OFFSETS.map(o => o + 4 <= buf.length ? buf.readInt32LE(o) : 'N/A');
  console.log('  ' + f.substring(0, 52).padEnd(54) + ' | ' +
    vals.map(v => typeof v === 'number' ? v.toString().padStart(8) : v).join(' | ') +
    ' | ' + buf.length);
}
