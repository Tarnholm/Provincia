// Find the exact boundary where files switch from aligned to shifted.
// Skip the 4-byte hash diff at 0x43f8 — files re-align there without shift.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav'));
const SHIFT = QUEUE.length - BASE.length;

console.log('SHIFT=' + SHIFT);

// Skip the path hash at 0x43f8 by starting from 0x5000
// Find first p where BASE[p..p+8] != QUEUE[p..p+8] AND BASE[p..p+8] == QUEUE[p+SHIFT..p+SHIFT+8]
console.log('Finding insertion boundary (first position where shift becomes effective)...');
for (let p = 0x5000; p < BASE.length - 16 - SHIFT; p++) {
  let alignedMatch = true;
  let shiftedMatch = true;
  for (let k = 0; k < 8; k++) {
    if (BASE[p + k] !== QUEUE[p + k]) alignedMatch = false;
    if (BASE[p + k] !== QUEUE[p + SHIFT + k]) shiftedMatch = false;
  }
  if (!alignedMatch && shiftedMatch) {
    // Found the AFTER-insertion zone start in BASE
    console.log('Insertion ENDS at BASE@0x' + p.toString(16) + ' (after this, BASE[p]==QUEUE[p+' + SHIFT + '])');
    // The actual insertion content is QUEUE[p..p+SHIFT-1] but that overlaps with last bytes
    // of BASE pre-insertion... Let me think.
    // BASE has [pre|post] layout. QUEUE has [pre|INSERTION|post] layout.
    // BASE[p..] = post. QUEUE[p+SHIFT..] = post. So QUEUE[p..p+SHIFT-1] is some
    // mix of trailing-pre + INSERTION. But actually QUEUE[p..p+SHIFT-1] is exactly
    // the NEW DATA inserted (the queue item bytes) IF the pre/post boundary in BASE
    // is at byte p.
    // To find where pre ends in BASE: find largest q<p where BASE[q-8..q]==QUEUE[q-8..q]
    let q = p;
    while (q > 0) {
      let aligned = true;
      for (let k = 0; k < 8; k++) {
        if (BASE[q - 1 - k] !== QUEUE[q - 1 - k]) { aligned = false; break; }
      }
      if (aligned) break;
      q--;
    }
    console.log('Pre-insertion content in BASE ends at 0x' + q.toString(16));
    console.log('Insertion in QUEUE occupies bytes 0x' + q.toString(16) + ' to 0x' + (p + SHIFT - 1).toString(16) + ' (' + (p + SHIFT - q) + ' bytes)');
    // Dump the insertion content
    const insStart = q;
    const insEnd = p + SHIFT;
    const insLen = insEnd - insStart;
    console.log('\nInserted bytes in QUEUE (' + insLen + ' bytes, but real insertion is ' + SHIFT + '):');
    for (let j = 0; j < insLen + 32; j += 16) {
      const len = Math.min(16, BASE.length - (insStart + j));
      const baseHex = Array.from(BASE.slice(insStart + j, insStart + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const queueHex = Array.from(QUEUE.slice(insStart + j, insStart + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log('  +' + j.toString().padStart(3) + ': BASE=' + baseHex.padEnd(48) + ' QUEUE=' + queueHex);
    }
    return;
  }
  if (p % 1_000_000 === 0) console.log('  ...scanning at 0x' + p.toString(16));
}
console.log('No boundary found');
