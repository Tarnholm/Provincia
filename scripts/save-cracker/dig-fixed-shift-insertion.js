// Use the known 45-byte shift to find where the insertion boundary is.
// BEFORE insertion: BASE[p] == QUEUE[p]
// INSIDE insertion: bytes that exist in QUEUE but not BASE
// AFTER insertion: BASE[p] == QUEUE[p+45]

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav'));

const SHIFT = QUEUE.length - BASE.length;  // 45
console.log('Total shift: ' + SHIFT);

// Walk forward, finding where BASE[p] stops equaling QUEUE[p]
let lastEqualP = -1;
for (let p = 0; p < BASE.length; p++) {
  if (BASE[p] === QUEUE[p]) lastEqualP = p;
  else break;
}
console.log('Last p where BASE[p]==QUEUE[p] from start: 0x' + lastEqualP.toString(16));

// Walk BACKWARD from end, finding where BASE[BASE.length-1-i] stops equaling QUEUE[QUEUE.length-1-i]
let lastEqualFromEnd = -1;
for (let i = 0; i < BASE.length; i++) {
  if (BASE[BASE.length - 1 - i] === QUEUE[QUEUE.length - 1 - i]) lastEqualFromEnd = i;
  else break;
}
console.log('Bytes matching at end: ' + lastEqualFromEnd);

// More important: find where BASE[p] starts matching QUEUE[p + SHIFT]
// (this is the "after the insertion" zone)
let firstMatch_shifted = -1;
for (let p = 0; p < BASE.length - 64; p++) {
  // Check 64 bytes
  let match = true;
  for (let k = 0; k < 64; k++) {
    if (BASE[p + k] !== QUEUE[p + SHIFT + k]) { match = false; break; }
  }
  if (match) { firstMatch_shifted = p; break; }
}
console.log('First p where BASE[p..p+64]==QUEUE[p+45..p+45+64]: 0x' + firstMatch_shifted.toString(16));

// But this is from start — we need the FIRST p AFTER the divergence point.
// Start scanning from the early divergence point.
let firstDivergence = -1;
for (let p = 0; p < BASE.length; p++) {
  if (BASE[p] !== QUEUE[p]) { firstDivergence = p; break; }
}
console.log('First divergence (linear): 0x' + firstDivergence.toString(16));

// Find where the SHIFTED alignment starts: scan from firstDivergence forward
let shiftedAlignStart = -1;
for (let p = firstDivergence; p < BASE.length - 32; p++) {
  let match = true;
  for (let k = 0; k < 32; k++) {
    if (BASE[p + k] !== QUEUE[p + SHIFT + k]) { match = false; break; }
  }
  if (match) { shiftedAlignStart = p; break; }
}
console.log('Shifted alignment starts at BASE@0x' + shiftedAlignStart.toString(16));

// So the insertion is in QUEUE between QUEUE[?] and QUEUE[shiftedAlignStart + SHIFT - 1]
// And in BASE, the data at [firstDivergence..shiftedAlignStart] should differ.
// The insertion content starts at QUEUE[firstDivergence-some] and ends at QUEUE[shiftedAlignStart + SHIFT - 1]
// (where SHIFT bytes were inserted).

// Where does the insertion start? Walk back from firstDivergence to find where BASE[p..p+32]
// no longer matches QUEUE[p..p+32]. The LAST p where it DOES match is just before the insertion.
let insertionStartInBase = firstDivergence;
console.log('Insertion starts at BASE@0x' + insertionStartInBase.toString(16) + ' (or earlier — multiple regions modified)');

// Print the bytes BASE has at [firstDivergence..shiftedAlignStart] (these are MODIFIED in QUEUE)
const modRegionLen = shiftedAlignStart - firstDivergence;
console.log('\nModified region: ' + modRegionLen + ' bytes in BASE, ' + (modRegionLen + SHIFT) + ' bytes in QUEUE');

// Show the modified region content
console.log('\n=== BASE bytes from 0x' + firstDivergence.toString(16) + ' to 0x' + shiftedAlignStart.toString(16) + ' (' + modRegionLen + ' bytes) ===');
for (let j = 0; j < Math.min(modRegionLen, 256); j += 16) {
  const len = Math.min(16, modRegionLen - j);
  const hex = Array.from(BASE.slice(firstDivergence + j, firstDivergence + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(BASE.slice(firstDivergence + j, firstDivergence + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + j.toString().padStart(3) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
}

console.log('\n=== QUEUE bytes from 0x' + firstDivergence.toString(16) + ' to 0x' + (firstDivergence + modRegionLen + SHIFT).toString(16) + ' (' + (modRegionLen + SHIFT) + ' bytes) ===');
for (let j = 0; j < Math.min(modRegionLen + SHIFT, 256); j += 16) {
  const len = Math.min(16, modRegionLen + SHIFT - j);
  const hex = Array.from(QUEUE.slice(firstDivergence + j, firstDivergence + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(QUEUE.slice(firstDivergence + j, firstDivergence + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + j.toString().padStart(3) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
}

// Where's Arretium relative to this?
function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}
const arrB = findUtf16(BASE, 'Arretium');
console.log('\nArretium in BASE @ 0x' + arrB.toString(16) + ', firstDivergence @ 0x' + firstDivergence.toString(16) + ' (Arretium - divergence = ' + (arrB - firstDivergence) + ')');
