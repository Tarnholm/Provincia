// Find where the 634KB growth happened QUEUE→POST. That's the SOLDIER section
// expanding when the retrain completed.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));
const POST = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));

// Find the LCS divergence point: walk byte-by-byte from 0, find first byte mismatch
// and find first byte mismatch from the END (working backwards).
console.log('Looking for the START of growth zone...');
let firstDiff = -1;
const minLen = Math.min(QUEUE.length, POST.length);
for (let p = 0; p < minLen; p++) {
  if (QUEUE[p] !== POST[p]) { firstDiff = p; break; }
}
console.log('First diff at 0x' + firstDiff.toString(16) + ' (' + firstDiff + ' bytes from start)');

// From the end: walking backward, find the last position where they STILL match (when aligned to end)
let lastMatchFromEnd = 0;
for (let i = 0; i < minLen; i++) {
  if (QUEUE[QUEUE.length - 1 - i] !== POST[POST.length - 1 - i]) {
    lastMatchFromEnd = i;
    break;
  }
}
const lastDiffPost = POST.length - 1 - lastMatchFromEnd;
const lastDiffQueue = QUEUE.length - 1 - lastMatchFromEnd;
console.log('Last diff: POST@0x' + lastDiffPost.toString(16) + ' / QUEUE@0x' + lastDiffQueue.toString(16) +
  ' (' + lastMatchFromEnd + ' bytes from end match)');

// So between firstDiff and lastDiffQueue (in QUEUE) / lastDiffPost (in POST) is the changed region.
const changedRegionQueue = lastDiffQueue - firstDiff;
const changedRegionPost = lastDiffPost - firstDiff;
console.log('Changed region span: QUEUE=' + changedRegionQueue + ' bytes, POST=' + changedRegionPost + ' bytes');
console.log('Growth in changed region: ' + (changedRegionPost - changedRegionQueue) + ' bytes');

// Sample 128 bytes from POST starting at firstDiff
console.log('\n=== Bytes at start of changed region in QUEUE (0x' + firstDiff.toString(16) + ') ===');
for (let j = 0; j < 128; j += 16) {
  const hex = Array.from(QUEUE.slice(firstDiff + j, firstDiff + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(QUEUE.slice(firstDiff + j, firstDiff + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
}

console.log('\n=== Bytes at start of changed region in POST (0x' + firstDiff.toString(16) + ') ===');
for (let j = 0; j < 128; j += 16) {
  const hex = Array.from(POST.slice(firstDiff + j, firstDiff + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
  const ascii = Array.from(POST.slice(firstDiff + j, firstDiff + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  console.log('  +' + j.toString().padStart(3) + ': ' + hex + '  |' + ascii + '|');
}

// What section is firstDiff in?
// 34M save: header up to ~0x3bad; tile attribute gap to ~0x10000+9.8M = ~0x99c000;
// settlement zone ~0x99c000+16M = ~0x19dc000; tail ~6.3M after
console.log('\nFile geography estimate:');
console.log('  firstDiff 0x' + firstDiff.toString(16) + ' = ' + (firstDiff / POST.length * 100).toFixed(1) + '% of POST');
console.log('  POST size: ' + POST.length);
// Compute likely zone
if (firstDiff < 0x10000) console.log('  → in HEADER');
else if (firstDiff < 0x99c000) console.log('  → in tile-attribute gap');
else if (firstDiff < 0x19dc000) console.log('  → in settlement zone');
else console.log('  → in TAIL');
