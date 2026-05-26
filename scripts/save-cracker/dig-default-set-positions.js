// Print ALL default_set marker positions and their gaps to understand
// per-settlement distribution.

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';
const SAVE = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 11 Epidamnus enslaved.sav'));

function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

// Find all default_set markers
const target = Buffer.from([0x0c, 0x00, 0x64, 0x65, 0x66, 0x61, 0x75, 0x6c, 0x74, 0x5f, 0x73, 0x65, 0x74, 0x00]);
const allDs = [];
let p = 0;
while (true) {
  const idx = SAVE.indexOf(target, p);
  if (idx === -1) break;
  allDs.push(idx);
  p = idx + 14;
}

// Also find all UTF-16 settlement names (capital-cased ASCII followed by lowercase)
// In save: pstr16 with UTF-16 LE = 2 bytes per char. A settlement name like "Athens" =
// 06 00 41 00 74 00 68 00 65 00 6e 00 73 00.
// To find candidates: scan for pstr16 patterns where every other byte is 0 and chars are ASCII capital+lowercase.

const settlementNames = [];
for (let off = 0; off < SAVE.length - 20; off += 1) {
  const lenChars = SAVE.readUInt16LE(off);
  if (lenChars < 3 || lenChars > 30) continue;
  // Each char takes 2 bytes, so lenChars chars = 2 * lenChars bytes
  const byteLen = lenChars * 2;
  if (off + 2 + byteLen + 2 > SAVE.length) continue;
  // Verify UTF-16 LE ASCII
  let ok = true;
  let str = '';
  for (let j = 0; j < lenChars; j++) {
    const lo = SAVE[off + 2 + j * 2];
    const hi = SAVE[off + 2 + j * 2 + 1];
    if (hi !== 0) { ok = false; break; }
    if (lo < 0x20 || lo > 0x7e) { ok = false; break; }
    str += String.fromCharCode(lo);
  }
  if (!ok) continue;
  // First char must be uppercase letter
  if (!/^[A-Z][a-zA-Z]+$/.test(str)) continue;
  if (str.length < 4) continue;
  settlementNames.push({ off, str });
  off += 1 + byteLen; // skip ahead
}

// Filter to likely settlement names — those that appear ONLY ONCE or in known list
const nameCount = {};
for (const n of settlementNames) nameCount[n.str] = (nameCount[n.str] || 0) + 1;

// Known Alexander settlement names
const knownAlex = ['Pella', 'Larissa', 'Athens', 'Sparta', 'Thermon', 'Halicarnassus', 'Sardis',
  'Tarsus', 'Antioch', 'Damascus', 'Tyre', 'Jerusalem', 'Gaza', 'Pelusium', 'Memphis', 'Alexandria',
  'Thebes', 'Ecbatana', 'Susa', 'Persepolis', 'Babylon', 'Ur', 'Arbela', 'Bactra', 'Maracanda',
  'Drapsaca', 'Alexandropolis', 'Taxila', 'Pattala', 'Epidamnus', 'Apollonia', 'Pelium',
  'Byzantium', 'Sestus', 'Sigeum', 'Halys', 'Mazaca', 'Nineveh', 'Pasargadae'];
const settlements = settlementNames.filter(n => knownAlex.includes(n.str) && nameCount[n.str] === 1);

console.log('Settlements found in save (' + settlements.length + '):');
settlements.sort((a, b) => a.off - b.off);
for (const s of settlements) console.log('  0x' + s.off.toString(16).padStart(6) + '  ' + s.str);

// Now map each default_set marker to the closest settlement BEFORE it
console.log('\n\nDefault_set markers and their nearest preceding settlement name:');
let lastSettlement = null;
let dsIdx = 0;
const settlementsByOff = settlements.sort((a, b) => a.off - b.off);
const dsByOff = allDs.slice().sort((a, b) => a - b);

// For each settlement, count the default_set markers between it and the next settlement
console.log('\nPer-settlement default_set marker count:');
for (let i = 0; i < settlementsByOff.length; i++) {
  const s = settlementsByOff[i];
  const nextOff = (i + 1 < settlementsByOff.length) ? settlementsByOff[i + 1].off : SAVE.length;
  const dsInRange = dsByOff.filter(d => d > s.off && d < nextOff);
  // Also check if any ds is BEFORE first settlement
  console.log('  ' + s.str.padEnd(20) + ' @0x' + s.off.toString(16) +
    ' has ' + dsInRange.length + ' default_set markers (' + dsInRange.map(d => '0x' + d.toString(16)).join(',') + ')');
}

// Any markers before the first settlement?
const firstSetOff = settlementsByOff[0]?.off || 0;
const beforeFirst = dsByOff.filter(d => d < firstSetOff);
console.log('\nMarkers BEFORE first settlement (' + beforeFirst.length + '): ' + beforeFirst.map(d => '0x' + d.toString(16)).join(','));
