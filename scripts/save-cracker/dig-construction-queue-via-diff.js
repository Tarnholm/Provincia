// Diff base Turn 1 vs "building queued in Sparta, Pella" save to find construction queue

const fs = require('fs');
const path = require('path');

const BASE_A = 'C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Alexander\\saves\\';

const base = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1.sav'));
const afterQueue = fs.readFileSync(path.join(BASE_A, 'save_17-05-2026   Macedon   Turn 1 building queued in Sparta, pella.sav'));

function findUtf16(buf, str) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(str.length, 0);
  const strBytes = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i++) strBytes.writeUInt16LE(str.charCodeAt(i), i * 2);
  return buf.indexOf(Buffer.concat([lenBuf, strBytes]));
}

// Diff Pella's stats block AND surrounding area
const pella1 = findUtf16(base, 'Pella');
const pella2 = findUtf16(afterQueue, 'Pella');
console.log('Pella base @ 0x' + pella1.toString(16) + ', queue @ 0x' + pella2.toString(16));
console.log('Shift: ' + (pella2 - pella1));

// Diff in stats block
console.log('\n=== Pella stats block byte diffs (-583..0) ===');
for (let dx = -583; dx <= 0; dx++) {
  const v1 = base[pella1 + dx];
  const v2 = afterQueue[pella2 + dx];
  if (v1 !== v2) {
    console.log('  dx=' + dx.toString().padStart(4) + ': base=' + v1 + '  queue=' + v2 + '  Δ=' + (v2 - v1));
  }
}

// Diff AFTER the name (where building list lives)
console.log('\n=== Diffs in 5000 bytes AFTER Pella name (building list zone) ===');
let diffCount = 0;
for (let dx = 0; dx < 5000 && diffCount < 50; dx++) {
  const p1 = pella1 + dx;
  const p2 = pella2 + dx;
  if (p1 >= base.length || p2 >= afterQueue.length) break;
  const v1 = base[p1];
  const v2 = afterQueue[p2];
  if (v1 !== v2) {
    console.log('  dx=+' + dx.toString().padStart(5) + ' (@0x' + p1.toString(16) + '): base=' + v1 + '  queue=' + v2 + '  Δ=' + (v2 - v1));
    diffCount++;
  }
}

// Also: look for ASCII building chain names appearing in queue save but not base
console.log('\n=== Look for pstr16 ASCII building names in 5000 bytes after Pella in QUEUE save ===');
function readPstr16Asciiz(buf, off) {
  if (off + 2 > buf.length) return null;
  const lenP1 = buf.readUInt16LE(off);
  if (lenP1 < 2 || lenP1 > 100) return null;
  if (off + 2 + lenP1 > buf.length) return null;
  for (let j = 0; j < lenP1 - 1; j++) {
    const c = buf[off + 2 + j];
    if (c < 0x20 || c > 0x7e) return null;
  }
  if (buf[off + 2 + lenP1 - 1] !== 0) return null;
  return { str: buf.slice(off + 2, off + 2 + lenP1 - 1).toString('latin1'), totalLen: 2 + lenP1 };
}

const queueStrs = [];
for (let p = pella2; p < pella2 + 5000 && p < afterQueue.length - 4; p++) {
  const r = readPstr16Asciiz(afterQueue, p);
  if (r && /^[a-z_][a-z_0-9]*$/.test(r.str) && r.str.length >= 4) {
    queueStrs.push({ off: p, str: r.str });
  }
}

const baseStrs = new Set();
for (let p = pella1; p < pella1 + 5000 && p < base.length - 4; p++) {
  const r = readPstr16Asciiz(base, p);
  if (r && /^[a-z_][a-z_0-9]*$/.test(r.str) && r.str.length >= 4) {
    baseStrs.add(r.str);
  }
}

console.log('Strings in QUEUE save not in BASE save:');
for (const s of queueStrs) {
  if (!baseStrs.has(s.str)) console.log('  0x' + s.off.toString(16) + '  ' + s.str);
}
