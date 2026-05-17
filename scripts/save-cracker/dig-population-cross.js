// Verify u32 at stats_block+48 is population by cross-referencing known cities

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const buf = fs.readFileSync(path.join(BASE, 'save_Autosave   Spain   Turn 4 Start.sav'));

function readPstr16Utf16Extended(buf, off) {
  if (off + 2 > buf.length) return null;
  const len = buf.readUInt16LE(off);
  if (len < 1 || len > 50) return null;
  if (off + 2 + len * 2 > buf.length) return null;
  const chars = [];
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + 2 + i * 2);
    if (c < 0x20 || c > 0x024F) return null;
    chars.push(String.fromCharCode(c));
  }
  return { str: chars.join(''), totalLen: 2 + len * 2 };
}

function findPstr16Asciiz(buf, str) {
  const len = str.length + 1;
  const prefix = Buffer.alloc(2);
  prefix.writeUInt16LE(len, 0);
  const target = Buffer.concat([prefix, Buffer.from(str + '\0')]);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    hits.push(p);
    p++;
  }
  return hits;
}

const defSets = findPstr16Asciiz(buf, 'default_set');
const settlements = [];
for (const ds of defSets) {
  let nameOff = -1;
  for (let step = -50; step <= 0; step++) {
    const c = ds - 18 + step;
    if (c < 0) continue;
    const r = readPstr16Utf16Extended(buf, c);
    if (r && r.totalLen === ds - c - 18) { nameOff = c; break; }
  }
  if (nameOff === -1) continue;
  // Find 0x15 section tag before name
  let tagOff = -1;
  for (let p = nameOff - 4; p > 0; p -= 4) {
    if (buf.readUInt32LE(p) === 0x15) { tagOff = p; break; }
  }
  if (tagOff === -1) continue;
  const blockStart = tagOff + 4;
  const pop = buf.readUInt32LE(blockStart + 48);
  settlements.push({
    name: readPstr16Utf16Extended(buf, nameOff).str,
    defSet: ds,
    pop,
    blockStart,
  });
}

console.log('=== Population u32 at stats_block+48 ===');
settlements.sort((a, b) => b.pop - a.pop);
for (const s of settlements.slice(0, 50)) {
  console.log('  ' + s.name.padEnd(22) + ' pop=' + String(s.pop).padStart(6));
}
console.log('\nTop settlements by population (likely largest cities):');
for (const s of settlements.slice(0, 10)) {
  console.log('  ' + s.name + ': ' + s.pop);
}
console.log('\nBottom 10 (likely villages):');
for (const s of settlements.slice(-10).reverse()) {
  console.log('  ' + s.name + ': ' + s.pop);
}

// Sanity check: total population should be reasonable
const total = settlements.reduce((sum, s) => sum + s.pop, 0);
console.log('\nTotal population across ' + settlements.length + ' settlements: ' + total);
console.log('Mean population: ' + Math.round(total / settlements.length));
