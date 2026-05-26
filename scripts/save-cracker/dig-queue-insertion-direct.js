// Look directly at bytes around 0xf85fff in PRE vs QUEUE
const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));

// Re-sync at higher shift — try up to 500
const startQ = 0xf85fff;
const startP = 0xf85fff;
console.log('Looking for re-sync between PRE@0x' + startP.toString(16) + ' and QUEUE @ various shifts');
for (let s = 1; s <= 500; s++) {
  let match = true;
  for (let k = 0; k < 32; k++) {
    if (PRE[startP + k] !== QUEUE[startQ + s + k]) { match = false; break; }
  }
  if (match) {
    console.log('  Re-sync at shift=+' + s + ' (QUEUE@0x' + (startQ + s).toString(16) + ')');
    break;
  }
}

// Dump bytes inserted: QUEUE[startQ..startQ+200]
console.log('\nBytes in QUEUE starting at 0x' + startQ.toString(16) + ' (likely retrain queue insertion):');
for (let j = 0; j < 256; j += 16) {
  const hex = Array.from(QUEUE.slice(startQ + j, startQ + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(QUEUE.slice(startQ + j, startQ + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
}

console.log('\nSame bytes in PRE starting at 0x' + startP.toString(16) + ':');
for (let j = 0; j < 256; j += 16) {
  const hex = Array.from(PRE.slice(startP + j, startP + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(PRE.slice(startP + j, startP + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
}

// Look BACKWARD from 0xf85fff to find an ASCII unit name in QUEUE
console.log('\nLooking for ASCII unit-name pstr16 in QUEUE near 0xf85fff:');
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

for (let p = startQ - 100; p < startQ + 400; p++) {
  const r = readPstr16Asciiz(QUEUE, p);
  if (r && r.str.length >= 4 && /^[a-z][a-z _]+$/.test(r.str)) {
    console.log('  0x' + p.toString(16) + ' "' + r.str + '"');
  }
}
