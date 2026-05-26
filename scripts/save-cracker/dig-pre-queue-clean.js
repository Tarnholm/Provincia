// Clean diff PRE→QUEUE (only 200 byte diff). The 200 bytes that differ
// should be: (a) the mod path size header at 0x43f8 changing by 4 bytes,
// (b) the queue item inserted near Arretium (~200 bytes).

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const PRE = fs.readFileSync(path.join(BASE_R, 'save_arretium pre retrained..sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium queued retrain.sav'));

console.log('PRE size: ' + PRE.length);
console.log('QUEUE size: ' + QUEUE.length + ' (Δ=' + (QUEUE.length - PRE.length) + ')');

// Find ALL insertion points walking from start, allowing local shifts of up to 300 bytes
let qp = 0, pp = 0;  // qp = pos in QUEUE (longer), pp = pos in PRE (shorter)
const insertionPoints = [];
let accumulatedShift = 0;

while (pp < PRE.length && qp < QUEUE.length) {
  // Match runs
  while (pp < PRE.length && qp < QUEUE.length && PRE[pp] === QUEUE[qp]) {
    pp++;
    qp++;
  }
  if (pp >= PRE.length) break;
  // Divergence — try to re-align
  let foundShift = -1;
  for (let s = 1; s <= 300; s++) {
    if (qp + s >= QUEUE.length) break;
    let match = true;
    for (let k = 0; k < 32; k++) {
      if (pp + k >= PRE.length || qp + s + k >= QUEUE.length) { match = false; break; }
      if (PRE[pp + k] !== QUEUE[qp + s + k]) { match = false; break; }
    }
    if (match) { foundShift = s; break; }
  }
  if (foundShift >= 0) {
    // QUEUE has 'foundShift' bytes inserted at this point
    insertionPoints.push({ preOff: pp, queueOff: qp, inserted: foundShift });
    accumulatedShift += foundShift;
    qp += foundShift;
    continue;
  }
  // No clean insertion — try byte-level replacement (one or few bytes differ, no shift)
  // Find where they re-match WITHOUT a shift
  let resyncOff = -1;
  for (let r = 1; r <= 100; r++) {
    if (pp + r >= PRE.length || qp + r >= QUEUE.length) break;
    // Check 32-byte match
    let match = true;
    for (let k = 0; k < 32; k++) {
      if (PRE[pp + r + k] !== QUEUE[qp + r + k]) { match = false; break; }
    }
    if (match) { resyncOff = r; break; }
  }
  if (resyncOff >= 0) {
    // Bytes differ in [pp..pp+resyncOff] vs [qp..qp+resyncOff]
    insertionPoints.push({ preOff: pp, queueOff: qp, replaced: resyncOff });
    pp += resyncOff;
    qp += resyncOff;
  } else {
    console.log('Cannot re-sync at PRE@0x' + pp.toString(16) + ' / QUEUE@0x' + qp.toString(16));
    break;
  }
}

console.log('\nFound ' + insertionPoints.length + ' divergence points:');
let totalInserted = 0;
for (const ip of insertionPoints) {
  if (ip.inserted) totalInserted += ip.inserted;
  console.log('  PRE@0x' + ip.preOff.toString(16) + '  QUEUE@0x' + ip.queueOff.toString(16) +
    (ip.inserted ? '  inserted ' + ip.inserted : '  replaced ' + ip.replaced) + ' bytes');
}
console.log('Total inserted: ' + totalInserted + ' (expected total shift: ' + (QUEUE.length - PRE.length) + ')');

// Dump the BIGGEST insertion
const biggest = insertionPoints.slice().sort((a, b) => (b.inserted || 0) - (a.inserted || 0))[0];
if (biggest && biggest.inserted) {
  console.log('\nBIGGEST insertion: ' + biggest.inserted + ' bytes at QUEUE@0x' + biggest.queueOff.toString(16));
  console.log('Inserted bytes (in QUEUE save):');
  for (let j = 0; j < biggest.inserted; j += 16) {
    const len = Math.min(16, biggest.inserted - j);
    const hex = Array.from(QUEUE.slice(biggest.queueOff + j, biggest.queueOff + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(QUEUE.slice(biggest.queueOff + j, biggest.queueOff + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(4) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
  }
}
