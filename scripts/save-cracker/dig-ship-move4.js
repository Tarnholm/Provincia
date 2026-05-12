// dig-ship-move4.js — verify the 0x0159126c candidate is a ship position record

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_5.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

const off = 0x0159126c;
// Dump 256 bytes around
const lo = off - 96;
const hi = off + 160;
console.log(`Context around ${hex(off)} (-96..+160):`);
console.log(`A: ${A.subarray(lo, hi).toString('hex')}`);
console.log(`B: ${B.subarray(lo, hi).toString('hex')}`);
// Mark diffs
let mark = '';
for (let i = lo; i < hi; i++) mark += (A[i] === B[i]) ? '.' : 'X';
console.log(`D: ${mark}`);

// ASCII context (UTF-16LE often used for names)
function ascii(buf, lo, hi) {
  let s = '';
  for (let i = lo; i < hi; i++) {
    const c = buf[i];
    s += (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
  }
  return s;
}
console.log(`Aasc: ${ascii(A, lo, hi)}`);
console.log(`Basc: ${ascii(B, lo, hi)}`);

// UTF-16LE strings nearby
function utf16Strings(buf, lo, hi, minLen = 4) {
  const out = [];
  let start = -1;
  let curr = '';
  for (let i = lo; i < hi - 1; i += 2) {
    const c = buf[i];
    const hi8 = buf[i + 1];
    if (hi8 === 0 && c >= 0x20 && c < 0x7f) {
      if (start === -1) start = i;
      curr += String.fromCharCode(c);
    } else {
      if (start !== -1 && curr.length >= minLen) {
        out.push({ off: start, str: curr });
      }
      start = -1;
      curr = '';
    }
  }
  if (start !== -1 && curr.length >= minLen) out.push({ off: start, str: curr });
  return out;
}
console.log('\nUTF-16LE strings in ±512 bytes:');
for (const s of utf16Strings(A, off - 512, off + 512)) {
  console.log(`  ${hex(s.off)}: "${s.str}"`);
}

// Also ASCII strings >=4 chars
function asciiStrings(buf, lo, hi, minLen = 6) {
  const out = [];
  let start = -1;
  for (let i = lo; i < hi; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) {
      if (start === -1) start = i;
    } else {
      if (start !== -1 && i - start >= minLen) {
        out.push({ off: start, str: buf.subarray(start, i).toString('ascii') });
      }
      start = -1;
    }
  }
  return out;
}
console.log('\nASCII strings ≥6 in ±2048 bytes:');
for (const s of asciiStrings(A, off - 2048, off + 2048)) {
  console.log(`  ${hex(s.off)}: "${s.str}"`);
}

// And read all u32s in the immediate ±64-byte vicinity to spot the schema
console.log('\nAligned u32s at ±64 of position record:');
const baseAlign = off & ~3;
for (let i = baseAlign - 64; i <= baseAlign + 64; i += 4) {
  const a = A.readUInt32LE(i);
  const b = B.readUInt32LE(i);
  const flag = (a !== b) ? '  <-- CHANGED' : '';
  console.log(`  ${hex(i)}: A=${a.toString(16).padStart(8, '0')} (${a}) B=${b.toString(16).padStart(8, '0')} (${b})${flag}`);
}
