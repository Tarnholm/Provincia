// Check Pella's stats block across all Alexander saves to find tax rate field.
// User mentioned Pella tax went 1→2 in some save.

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const allFiles = fs.readdirSync(BASE_A).filter(f => f.endsWith('.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

console.log('Pella stats across Alexander saves (using stats_block dx layout):');
console.log('save                                                              | level | PO   | income | population | dx=-310 | dx=-78  | dx=-46 (bldg?)');
const sorted = allFiles.slice().sort();
for (const f of sorted) {
  const buf = fs.readFileSync(path.join(BASE_A, f));
  const off = findUtf16(buf, 'Pella');
  if (off === -1 || off - 583 < 0) continue;
  const level = buf.readInt32LE(off - 571);
  const po = buf.readInt32LE(off - 435);
  const income = buf.readInt32LE(off - 127);
  const pop = buf.readInt32LE(off - 35);
  const tax310 = buf.readInt32LE(off - 310);
  const tax78 = buf.readInt32LE(off - 78);
  const bldg46 = buf.readInt32LE(off - 46);
  console.log('  ' + f.substring(0, 62).padEnd(64) + ' | ' + level.toString().padStart(5) + ' | ' + po.toString().padStart(4) + ' | ' + income.toString().padStart(6) + ' | ' + pop.toString().padStart(10) + ' | ' + tax310.toString().padStart(7) + ' | ' + tax78.toString().padStart(7) + ' | ' + bldg46.toString().padStart(7));
}
