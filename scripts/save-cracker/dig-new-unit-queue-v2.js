// Better insertion finder: smaller resync window, scan changes around Arretium

const fs = require('fs');
const path = require('path');

const BASE_R = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\';
const BASE = fs.readFileSync(path.join(BASE_R, 'save_arretium retrained turn 2.sav'));
const QUEUE = fs.readFileSync(path.join(BASE_R, 'save_arretium turn 2 new unit queued.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

const arrB = findUtf16(BASE, 'Arretium');
const arrQ = findUtf16(QUEUE, 'Arretium');
console.log('Arretium BASE @ 0x' + arrB.toString(16) + ', QUEUE @ 0x' + arrQ.toString(16) + ' (shift=' + (arrQ - arrB) + ')');

// Bug fix: use 12-byte resync window instead of 32, and start scan EARLIER
let bp = arrB - 2000;
let qp = arrQ - 2000;
const insertionPoints = [];
const replacements = [];
const limit = arrB + 2000;
const RESYNC_LEN = 12;

while (bp < limit && bp < BASE.length - RESYNC_LEN && qp < QUEUE.length - RESYNC_LEN) {
  while (bp < limit && BASE[bp] === QUEUE[qp]) {
    bp++; qp++;
  }
  if (bp >= limit) break;

  // Try insertion (shift QUEUE forward)
  let foundShift = -1;
  for (let s = 1; s <= 100; s++) {
    let match = true;
    for (let k = 0; k < RESYNC_LEN; k++) {
      if (BASE[bp + k] !== QUEUE[qp + s + k]) { match = false; break; }
    }
    if (match) { foundShift = s; break; }
  }

  if (foundShift > 0) {
    insertionPoints.push({ baseOff: bp, queueOff: qp, inserted: foundShift });
    qp += foundShift;
  } else {
    // No insertion — try byte replacement
    let resync = -1;
    for (let r = 1; r <= 50; r++) {
      let match = true;
      for (let k = 0; k < RESYNC_LEN; k++) {
        if (BASE[bp + r + k] !== QUEUE[qp + r + k]) { match = false; break; }
      }
      if (match) { resync = r; break; }
    }
    if (resync > 0) {
      replacements.push({ off: bp, len: resync });
      bp += resync;
      qp += resync;
    } else {
      console.log('Stuck at BASE@0x' + bp.toString(16));
      break;
    }
  }
}

console.log('\nInsertion points (added bytes):');
for (const ip of insertionPoints) {
  console.log('  BASE@0x' + ip.baseOff.toString(16) + ' QUEUE@0x' + ip.queueOff.toString(16) + ' added ' + ip.inserted + ' bytes');
}

console.log('\nReplacement points (modified, no shift):');
for (const rp of replacements) {
  console.log('  BASE@0x' + rp.off.toString(16) + ' changed ' + rp.len + ' bytes');
}

const totalInserted = insertionPoints.reduce((s, ip) => s + ip.inserted, 0);
console.log('\nTotal inserted: ' + totalInserted + ' (expected file growth=' + (QUEUE.length - BASE.length) + ')');

// Dump the bytes inserted in QUEUE for each insertion
for (const ip of insertionPoints) {
  console.log('\n=== Inserted ' + ip.inserted + ' bytes in QUEUE @ 0x' + ip.queueOff.toString(16) + ' ===');
  for (let j = 0; j < ip.inserted; j += 16) {
    const len = Math.min(16, ip.inserted - j);
    const hex = Array.from(QUEUE.slice(ip.queueOff + j, ip.queueOff + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(QUEUE.slice(ip.queueOff + j, ip.queueOff + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('  +' + j.toString().padStart(3) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
  }

  // Context: 32 bytes BEFORE the insertion in BASE
  console.log('  Context (32 bytes BEFORE):');
  const ctxStart = Math.max(0, ip.baseOff - 32);
  for (let j = 0; j < ip.baseOff - ctxStart; j += 16) {
    const len = Math.min(16, ip.baseOff - ctxStart - j);
    const hex = Array.from(BASE.slice(ctxStart + j, ctxStart + j + len)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(BASE.slice(ctxStart + j, ctxStart + j + len)).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log('    ' + (ctxStart + j).toString(16) + ': ' + hex.padEnd(48) + '  |' + ascii + '|');
  }
}

// Show replacement context too
for (const rp of replacements) {
  console.log('\n=== Replacement at 0x' + rp.off.toString(16) + ' (' + rp.len + ' bytes) ===');
  console.log('  BASE:  ' + Array.from(BASE.slice(rp.off, rp.off + rp.len)).map(b => b.toString(16).padStart(2, '0')).join(' '));
  console.log('  QUEUE: ' + Array.from(QUEUE.slice(rp.off + (arrQ - arrB), rp.off + (arrQ - arrB) + rp.len)).map(b => b.toString(16).padStart(2, '0')).join(' '));
}
