// Find HOTSPOTS of growth between QUEUE and POST — chunks where many bytes differ.
// These are likely the soldier section + faction state updates.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));
const POST = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));

// Bin into 64KB chunks. For each chunk, count bytes that differ between QUEUE and
// the corresponding POST chunk (with alignment shift handling).

const CHUNK = 64 * 1024;
const chunks = Math.ceil(POST.length / CHUNK);
const queueChunks = Math.ceil(QUEUE.length / CHUNK);

// Simple aligned diff (no shift compensation).
// This works if the growth is appended near the END.
console.log('Aligned diff QUEUE vs POST (assuming changes are local to chunks):');
let totalDiff = 0;
const minChunks = Math.min(chunks, queueChunks);
const hotspots = [];
for (let i = 0; i < minChunks; i++) {
  const start = i * CHUNK;
  const end = Math.min(start + CHUNK, QUEUE.length, POST.length);
  let diff = 0;
  for (let p = start; p < end; p++) {
    if (QUEUE[p] !== POST[p]) diff++;
  }
  if (diff > 1000) hotspots.push({ chunk: i, off: start, diff });
  totalDiff += diff;
}
console.log('Total aligned-diff bytes: ' + totalDiff);
console.log('Hotspots (chunks with >1000 byte diffs):');
hotspots.sort((a, b) => b.diff - a.diff);
for (const h of hotspots.slice(0, 20)) {
  console.log('  chunk ' + h.chunk + ' @ 0x' + h.off.toString(16) + ': ' + h.diff + ' bytes differ');
}

// For QUEUE→POST, also try shift-compensated approach: maybe the 634KB grew
// at one point and shifted everything after by 634KB.
// To find the insertion point: align from start until first diff, then check
// if QUEUE[firstDiff..] matches POST[firstDiff + 634156..]
console.log('\n=== Insertion-point detection ===');
const SHIFT = POST.length - QUEUE.length;
console.log('Total growth: ' + SHIFT + ' bytes');

// Walk forward to find where they DIVERGE (first diff)
let firstDiff = 0;
for (let p = 0; p < QUEUE.length; p++) {
  if (QUEUE[p] !== POST[p]) { firstDiff = p; break; }
}
// Walk backward to find where they CONVERGE (i.e., POST[POST.len-i] == QUEUE[QUEUE.len-i])
let endMatch = 0;
for (let i = 0; i < QUEUE.length; i++) {
  if (QUEUE[QUEUE.length - 1 - i] !== POST[POST.length - 1 - i]) break;
  endMatch++;
}
console.log('  firstDiff (forward): 0x' + firstDiff.toString(16));
console.log('  endMatch (from end): ' + endMatch + ' bytes match at tail');

// Now try to find INSERTION POINTS. Walk forward from firstDiff, looking for
// the position where POST[p+SHIFT] starts matching QUEUE[p]. That's where the
// insertion was made.
console.log('  Scanning for insertion point...');
let insertionPoint = -1;
for (let p = firstDiff; p < Math.min(QUEUE.length - 100, 10_000_000); p += 1) {
  // Check if QUEUE[p..p+100] matches POST[p+SHIFT..p+SHIFT+100]
  let match = true;
  for (let k = 0; k < 100; k++) {
    if (QUEUE[p + k] !== POST[p + SHIFT + k]) { match = false; break; }
  }
  if (match) {
    insertionPoint = p;
    break;
  }
}
if (insertionPoint > 0) {
  console.log('  → INSERTION POINT at 0x' + insertionPoint.toString(16) + ' (' + (insertionPoint / QUEUE.length * 100).toFixed(1) + '% of file)');
  // Dump the bytes just after the insertion point in POST (where the new soldiers are)
  console.log('\n  Bytes inserted into POST at 0x' + insertionPoint.toString(16) + ':');
  for (let j = 0; j < 256; j += 16) {
    const hex = Array.from(POST.slice(insertionPoint + j, insertionPoint + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(POST.slice(insertionPoint + j, insertionPoint + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
  }
}
