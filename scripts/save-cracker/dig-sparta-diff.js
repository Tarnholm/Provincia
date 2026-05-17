// Byte-by-byte diff of Sparta's complete record across T1 → T15

const fs = require('fs');
const path = require('path');

const BASE = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const T1 = fs.readFileSync(path.join(BASE, 'save_17-05-2026   Macedon   Turn 1.sav'));
const T15 = fs.readFileSync(path.join(BASE, 'save_Autosave   Macedon   Turn 15.sav'));

function findSparta(buf) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(6, 0);
  const strBytes = Buffer.alloc(12);
  for (let i = 0; i < 6; i++) strBytes.writeUInt16LE('Sparta'.charCodeAt(i), i * 2);
  const target = Buffer.concat([lenBuf, strBytes]);
  return buf.indexOf(target);
}

const t1Sparta = findSparta(T1);
const t15Sparta = findSparta(T15);
console.log('T1 Sparta name at 0x' + t1Sparta.toString(16));
console.log('T15 Sparta name at 0x' + t15Sparta.toString(16));

// Extract 3000 bytes after each
const T1_DATA = T1.slice(t1Sparta, t1Sparta + 3000);
const T15_DATA = T15.slice(t15Sparta, t15Sparta + 3000);

// Find differing bytes
console.log('\n=== Differing bytes in Sparta\'s 3000-byte record ===');
let diffCount = 0;
let firstDiff = -1;
let inDiffRun = false;
let diffRunStart = -1;
for (let i = 0; i < 3000; i++) {
  if (T1_DATA[i] !== T15_DATA[i]) {
    if (firstDiff === -1) firstDiff = i;
    if (!inDiffRun) {
      diffRunStart = i;
      inDiffRun = true;
    }
    diffCount++;
  } else {
    if (inDiffRun) {
      const runLen = i - diffRunStart;
      if (runLen >= 1) {
        // Show this diff run
        const t1Bytes = Array.from(T1_DATA.slice(diffRunStart, i)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        const t15Bytes = Array.from(T15_DATA.slice(diffRunStart, i)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log('  bytes +' + diffRunStart + '..+' + (i-1) + ' (' + runLen + ' bytes):');
        console.log('    T1:  ' + t1Bytes);
        console.log('    T15: ' + t15Bytes);
      }
      inDiffRun = false;
    }
  }
}
console.log('\nTotal differing bytes: ' + diffCount + ' out of 3000');
console.log('First differing byte at offset +' + firstDiff);
