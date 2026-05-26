// Verify dx=-562 is tax rate by comparing base vs "Sparta taxes lowered" save

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const base = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav'));
const afterTax = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1 taxes lowered in sparta.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const sparta1 = findUtf16(base, 'Sparta');
const sparta2 = findUtf16(afterTax, 'Sparta');
console.log('Sparta base @ 0x' + sparta1.toString(16));
console.log('Sparta afterTax @ 0x' + sparta2.toString(16));

console.log('\n=== Sparta stats block byte diffs ===');
for (let dx = -583; dx <= 0; dx++) {
  const v1 = base[sparta1 + dx];
  const v2 = afterTax[sparta2 + dx];
  if (v1 !== v2) {
    console.log('  dx=' + dx.toString().padStart(4) + ': base=' + v1 + '  after=' + v2 + '  Δ=' + (v2 - v1));
  }
}

console.log('\n=== Sparta tax rate at dx=-562 in all Alex saves ===');
const allFiles = fs.readdirSync(BASE_A).filter(f => f.endsWith('.sav'));
for (const f of allFiles.sort()) {
  const buf = fs.readFileSync(path.join(BASE_A, f));
  const off = findUtf16(buf, 'Sparta');
  if (off === -1) continue;
  const tax = buf[off - 562];
  console.log('  ' + f.substring(0, 60).padEnd(62) + '  tax=' + tax);
}
