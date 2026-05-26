// Locate the actual 45-byte insertion by sliding window comparison.
// For each position, check whether BASE[p..p+128]==QUEUE[p..p+128] (aligned, before insertion)
// or BASE[p..p+128]==QUEUE[p+45..p+45+128] (shifted, after insertion).
// The TRANSITION between these tells us where the insertion is.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav'));
const SHIFT = QUEUE.length - BASE.length;

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}
const arrB = findUtf16(BASE, 'Arretium');

// For each position p, test:
//   alignedOk = BASE[p..p+64]==QUEUE[p..p+64]
//   shiftedOk = BASE[p..p+64]==QUEUE[p+SHIFT..p+SHIFT+64]
function testAt(p, len = 64) {
  if (p + len + SHIFT > QUEUE.length) return { aligned: false, shifted: false };
  let aligned = true, shifted = true;
  for (let k = 0; k < len; k++) {
    if (BASE[p + k] !== QUEUE[p + k]) aligned = false;
    if (BASE[p + k] !== QUEUE[p + SHIFT + k]) shifted = false;
    if (!aligned && !shifted) break;
  }
  return { aligned, shifted };
}

// Scan in 4KB steps to find regime changes
console.log('Scanning regime (aligned/shifted) in 4KB steps:');
const STEP = 4096;
let lastRegime = null;
for (let p = 0; p < BASE.length - 64 - SHIFT; p += STEP) {
  const r = testAt(p);
  let regime;
  if (r.aligned && r.shifted) regime = 'both';
  else if (r.aligned) regime = 'aligned';
  else if (r.shifted) regime = 'shifted';
  else regime = 'neither';
  if (regime !== lastRegime) {
    console.log('  0x' + p.toString(16) + ': ' + regime);
    lastRegime = regime;
  }
}

// Zoom into transition (where aligned→shifted or aligned→neither happens)
// Then narrow further with 64-byte steps
console.log('\nZooming for first aligned→shifted/neither transition (64-byte steps):');
const transition = (() => {
  let last = 'aligned';
  for (let p = 0; p < BASE.length - 128 - SHIFT; p += 64) {
    const r = testAt(p);
    if (r.aligned) last = 'aligned';
    else return p;
  }
  return -1;
})();
console.log('  Transition starts around 0x' + transition.toString(16));

// Now narrow byte-by-byte to find EXACT insertion point
console.log('\nNarrowing byte by byte around transition:');
const winStart = Math.max(0, transition - 100);
const winEnd = Math.min(BASE.length - 64 - SHIFT, transition + 2000);
let insertionEnd = -1;
for (let p = winStart; p < winEnd; p++) {
  const r = testAt(p, 32);
  if (r.shifted && !r.aligned) {
    // First p where ONLY shifted matches — that's right AFTER the insertion
    insertionEnd = p;
    break;
  }
}
console.log('  After-insertion alignment starts at BASE@0x' + insertionEnd.toString(16));

let insertionStart = -1;
for (let p = winStart; p < winEnd; p++) {
  const r = testAt(p, 32);
  if (!r.aligned) {
    insertionStart = p;
    break;
  }
}
console.log('  Before-insertion ends at BASE@0x' + insertionStart.toString(16));
console.log('  Insertion in QUEUE occupies bytes ' + insertionStart + ' (=0x' + insertionStart.toString(16) + ') to ' +
  (insertionEnd + SHIFT - 1) + ' (=0x' + (insertionEnd + SHIFT - 1).toString(16) + ')');

// What's at Arretium relative to the insertion?
console.log('\nArretium in BASE at 0x' + arrB.toString(16));
console.log('Insertion start at 0x' + insertionStart.toString(16) + ' (Arretium - insertion = ' + (arrB - insertionStart) + ')');

// Dump the inserted bytes (in QUEUE save)
if (insertionStart > 0 && insertionEnd > insertionStart) {
  const insLen = insertionEnd - insertionStart + SHIFT;
  console.log('\n=== Inserted/modified region in QUEUE (' + insLen + ' bytes) ===');
  for (let j = 0; j < Math.min(insLen, 256); j += 16) {
    const len = Math.min(16, insLen - j);
    const hex = Array.from(QUEUE.slice(insertionStart + j, insertionStart + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(QUEUE.slice(insertionStart + j, insertionStart + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(3) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
  }

  const baseLen = insertionEnd - insertionStart;
  console.log('\n=== Same region in BASE (' + baseLen + ' bytes) ===');
  for (let j = 0; j < Math.min(baseLen, 256); j += 16) {
    const len = Math.min(16, baseLen - j);
    const hex = Array.from(BASE.slice(insertionStart + j, insertionStart + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(BASE.slice(insertionStart + j, insertionStart + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(3) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
  }
}
