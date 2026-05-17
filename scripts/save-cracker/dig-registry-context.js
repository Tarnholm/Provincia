// Look at what surrounds the section type registry — there might be section
// pointers/offsets at 0x100-0x500 (before names) or after registry end.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function hex(off, len) {
  return Array.from(buf.slice(off, off + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

// 1. Look at 0x100..0x500 (before names start at 0x56a)
console.log('=== 0x100..0x560 (before registry names start) ===');
for (let p = 0x100; p < 0x560; p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}

// 2. Find where registry ENDS — last section name
// Re-parse to find end
const registry = [];
let q = 0x500;
while (q < 0x2000) {
  if (buf[q] < 0x41 || buf[q] > 0x5a) { q++; continue; }
  let qe = q;
  while (qe < buf.length && buf[qe] >= 0x20 && buf[qe] <= 0x7e) qe++;
  const len = qe - q;
  if (len < 4) { q = qe + 1; continue; }
  const name = buf.slice(q, qe).toString('latin1');
  if (!/^[A-Z][A-Z_0-9]+$/.test(name)) { q = qe + 1; continue; }
  if (buf[qe] !== 0) { q = qe + 1; continue; }
  const countOff = qe + 1;
  if (countOff + 4 > buf.length) break;
  const count = buf.readUInt32LE(countOff);
  if (count > 100000) { q = qe + 1; continue; }
  registry.push({ nameOff: q, name, count, countOff });
  q = countOff + 4;
}

const lastEntry = registry[registry.length - 1];
const registryEnd = lastEntry.countOff + 4;
console.log('\nRegistry: ' + registry.length + ' entries');
console.log('First name @ 0x' + registry[0].nameOff.toString(16));
console.log('Last entry: ' + lastEntry.name + ' @ 0x' + lastEntry.nameOff.toString(16) + ', count=' + lastEntry.count);
console.log('Registry END at 0x' + registryEnd.toString(16));

// 3. Show what comes AFTER the registry ends
console.log('\n=== Bytes AFTER registry ends (0x' + registryEnd.toString(16) + '..0x' + (registryEnd + 0x200).toString(16) + ') ===');
for (let p = registryEnd; p < Math.min(registryEnd + 0x300, 0x1190); p += 16) {
  console.log('  0x' + p.toString(16) + ': ' + hex(p, 16));
}

// 4. Look for u32 values that look like file offsets (pointers > 0x10000 and < file size)
// in the 0x100..0x500 zone
console.log('\n=== Plausible file pointers in 0x100..0x500 ===');
const fileSize = buf.length;
for (let off = 0x100; off < 0x500; off += 4) {
  const v = buf.readUInt32LE(off);
  if (v < 0x10000 || v > fileSize - 100) continue;
  console.log('  u32@0x' + off.toString(16) + ' = 0x' + v.toString(16));
}
