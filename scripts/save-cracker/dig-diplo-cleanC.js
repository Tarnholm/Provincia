// Session 32 step C: re-examine the data context for 0x103286 and 0xa775de.
// We're looking at "05 -> 01" enum flips. What's their structural role?
// Show 1KB before and after each, and look for nearby ASCII tokens.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

function dump(buf, start, len, label) {
  console.log(`--- ${label} @ 0x${start.toString(16)} (${len} bytes) ---`);
  for (let i = 0; i < len; i += 16) {
    const off = start + i;
    const slice = buf.slice(off, Math.min(off + 16, start + len));
    const hexs = Array.from(slice).map(x => x.toString(16).padStart(2, '0')).join(' ');
    const asciis = Array.from(slice).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
    console.log(`  ${off.toString(16).padStart(8, '0')}: ${hexs.padEnd(48)} ${asciis}`);
  }
}

function findStrings(buf, start, len, minLen = 4) {
  const out = [];
  let cur = '';
  let curStart = -1;
  for (let i = start; i < start + len; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) {
      if (cur === '') curStart = i;
      cur += String.fromCharCode(c);
    } else {
      if (cur.length >= minLen) out.push({ off: curStart, str: cur });
      cur = '';
    }
  }
  if (cur.length >= minLen) out.push({ off: curStart, str: cur });
  return out;
}

// AREA 1: search for nearby ASCII tokens within 2KB of 0x103286.
console.log(`\n=== ASCII tokens near 0x103286 ===`);
const strs1 = findStrings(a, 0x102800, 0x2000, 4);
for (const s of strs1.slice(0, 50)) console.log(`  0x${s.off.toString(16)}: ${JSON.stringify(s.str)}`);

console.log(`\n=== ASCII tokens near 0xa775de ===`);
const strs2 = findStrings(a, 0xa76b00, 0x2000, 4);
for (const s of strs2.slice(0, 50)) console.log(`  0x${s.off.toString(16)}: ${JSON.stringify(s.str)}`);

// Wider context. Print 1024 bytes before each.
console.log(`\n=== 1024 bytes before 0x103286 ===`);
dump(a, 0x102e80, 0x400, 'A');

console.log(`\n=== 1024 bytes before 0xa775de ===`);
dump(a, 0xa771e0, 0x400, 'A');
