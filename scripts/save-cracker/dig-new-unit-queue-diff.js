// Diff T2 retrain (baseline) vs T2 with new unit queued (+45 bytes inserted).
// The 45 bytes added are the new recruit's queue item.

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const T2_BASE = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));
const T2_QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav'));

console.log('T2 baseline: ' + T2_BASE.length);
console.log('T2 queued:   ' + T2_QUEUE.length + ' (Δ=' + (T2_QUEUE.length - T2_BASE.length) + ')');

// Find Arretium in both
function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const arrBase = findUtf16(T2_BASE, 'Arretium');
const arrQueue = findUtf16(T2_QUEUE, 'Arretium');
console.log('Arretium T2_BASE @ 0x' + arrBase.toString(16));
console.log('Arretium T2_QUEUE @ 0x' + arrQueue.toString(16));
console.log('Shift: ' + (arrQueue - arrBase));

// Walk forward to find divergence
const minLen = Math.min(T2_BASE.length, T2_QUEUE.length);
let firstDiff = -1;
for (let p = 0; p < minLen; p++) {
  if (T2_BASE[p] !== T2_QUEUE[p]) { firstDiff = p; break; }
}
console.log('First divergence at 0x' + firstDiff.toString(16));

// The first divergence is probably a header byte change (timestamp, hash).
// Let me scan SPECIFICALLY around Arretium and find the insertion.
console.log('\nScanning ±1000 bytes around Arretium for the queue insertion...');
let queueInsertionStart = -1;
for (let dx = -500; dx < 500; dx++) {
  if (T2_BASE[arrBase + dx] !== T2_QUEUE[arrQueue + dx]) {
    queueInsertionStart = arrBase + dx;
    console.log('  First diff in Arretium region: BASE@0x' + (arrBase + dx).toString(16) + ' (dx=' + dx + ')');
    break;
  }
}

// Find insertion using LCS-style walk near Arretium
console.log('\n=== Walking from Arretium-1000 to find queue insertion ===');
let bp = arrBase - 1000;
let qp = arrQueue - 1000;
const insertionPoints = [];
const limit = arrBase + 1500;
while (bp < limit && bp < T2_BASE.length - 32 && qp < T2_QUEUE.length - 32) {
  while (bp < limit && T2_BASE[bp] === T2_QUEUE[qp]) {
    bp++; qp++;
  }
  if (bp >= limit) break;
  // Find re-sync with shift
  let foundShift = -1;
  for (let s = 1; s <= 200; s++) {
    let match = true;
    for (let k = 0; k < 32; k++) {
      if (T2_BASE[bp + k] !== T2_QUEUE[qp + s + k]) { match = false; break; }
    }
    if (match) { foundShift = s; break; }
  }
  if (foundShift > 0) {
    insertionPoints.push({ baseOff: bp, queueOff: qp, inserted: foundShift });
    qp += foundShift;
  } else {
    console.log('  Could not re-sync at BASE@0x' + bp.toString(16));
    break;
  }
}

console.log('Insertion points near Arretium:');
for (const ip of insertionPoints) {
  console.log('  BASE@0x' + ip.baseOff.toString(16) + ' QUEUE@0x' + ip.queueOff.toString(16) + ' inserted ' + ip.inserted + ' bytes');
}

// Dump the inserted bytes for each insertion
for (const ip of insertionPoints) {
  console.log('\n--- Inserted bytes (' + ip.inserted + ') at QUEUE@0x' + ip.queueOff.toString(16) + ' ---');
  for (let j = 0; j < ip.inserted; j += 16) {
    const len = Math.min(16, ip.inserted - j);
    const hex = Array.from(T2_QUEUE.slice(ip.queueOff + j, ip.queueOff + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T2_QUEUE.slice(ip.queueOff + j, ip.queueOff + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(3) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
  }
}

// Also dump the bytes JUST BEFORE the insertion (for context)
if (insertionPoints.length > 0) {
  const ip = insertionPoints[0];
  console.log('\n--- 32 bytes BEFORE the insertion (BASE save context) ---');
  for (let j = -32; j < 0; j += 16) {
    const hex = Array.from(T2_BASE.slice(ip.baseOff + j, ip.baseOff + j + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(T2_BASE.slice(ip.baseOff + j, ip.baseOff + j + 16)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  ' + j.toString().padStart(4) + ': ' + hex + '  |' + ascii + '|');
  }
}
