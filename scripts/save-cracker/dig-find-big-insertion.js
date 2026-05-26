// Find the BIG insertion in the tail where soldier records grew.
// Strategy: try multiple shift values (the file might have several insertion points).
// At each position p, check if a long run of QUEUE bytes from p matches POST bytes
// from p+SHIFT for any small SHIFT in [0, 700000].

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));
const POST = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));

const TOTAL_SHIFT = POST.length - QUEUE.length;
console.log('Total shift: ' + TOTAL_SHIFT + ' bytes');

// Multi-step LCS-like: scan from start, when bytes diverge, try increasing SHIFTs
// to re-align. Find each insertion point.
const insertionPoints = [];
let qp = 0;  // position in QUEUE
let pp = 0;  // position in POST
let runStart = 0;
const MAX_INSERTIONS = 20;

while (qp < QUEUE.length && pp < POST.length && insertionPoints.length < MAX_INSERTIONS) {
  // Match runs of equal bytes
  while (qp < QUEUE.length && pp < POST.length && QUEUE[qp] === POST[pp]) {
    qp++;
    pp++;
  }
  if (qp >= QUEUE.length) break;
  // Divergence! Try to re-align. Find shifts where POST[pp+S..] matches QUEUE[qp..]
  // for a long stretch.
  let foundShift = -1;
  const MAX_LOCAL_SHIFT = 300000;
  for (let s = 1; s <= MAX_LOCAL_SHIFT; s++) {
    if (pp + s >= POST.length) break;
    // Check long match: QUEUE[qp..qp+256] vs POST[pp+s..pp+s+256]
    let match = true;
    for (let k = 0; k < 256; k++) {
      if (qp + k >= QUEUE.length || pp + s + k >= POST.length) { match = false; break; }
      if (QUEUE[qp + k] !== POST[pp + s + k]) { match = false; break; }
    }
    if (match) { foundShift = s; break; }
  }
  if (foundShift < 0) {
    console.log('Could not re-align after divergence at QUEUE@0x' + qp.toString(16) + ' / POST@0x' + pp.toString(16));
    break;
  }
  insertionPoints.push({ queueOff: qp, postOff: pp, shift: foundShift });
  pp += foundShift;
}

console.log('\nFound ' + insertionPoints.length + ' insertion points:');
let totalShiftAccumulated = 0;
for (const ip of insertionPoints) {
  totalShiftAccumulated += ip.shift;
  console.log('  QUEUE@0x' + ip.queueOff.toString(16) +
    '  POST@0x' + ip.postOff.toString(16) +
    '  inserted ' + ip.shift + ' bytes  (cum=' + totalShiftAccumulated + ')');
}

// Find the LARGEST insertion
const biggest = insertionPoints.slice().sort((a, b) => b.shift - a.shift)[0];
if (biggest) {
  console.log('\nBIGGEST insertion: ' + biggest.shift + ' bytes at POST@0x' + biggest.postOff.toString(16));
  console.log('Bytes inserted in POST starting at 0x' + biggest.postOff.toString(16) + ':');
  for (let j = 0; j < 384; j += 16) {
    const hex = Array.from(POST.slice(biggest.postOff + j, biggest.postOff + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(POST.slice(biggest.postOff + j, biggest.postOff + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
  }
}
