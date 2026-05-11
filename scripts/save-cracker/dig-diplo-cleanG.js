// Session 32 step G: re-examine bytes at A[0][156] and B[0][156] precisely.
// Matrix start = 0xf8fd2 (first enum). Index 0*239+156 = 156. Offset: 0xf8fd2 + 156*267 = 0x103286.
// Wait, that matches our flip1 location exactly! Let's confirm.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

const stride = 267;
const matStart = 0xf8fd2;

// Index 0,156: byte offset = matStart + 156*267 = 0xf8fd2 + 0xa2b4 = 0x103286.
const offA = matStart + 156 * stride;
console.log(`[0][156] byte offset = 0x${offA.toString(16)}`);
console.log(`Expected flip1 = 0x103286, computed = 0x${offA.toString(16)}`);
console.log(`A at 0x${offA.toString(16)}: ${a.slice(offA, offA + 16).toString('hex')}`);
console.log(`B at 0x${offA.toString(16)}: ${b.slice(offA, offA + 16).toString('hex')}`);
console.log(`A readUInt32LE: ${a.readUInt32LE(offA)}`);
console.log(`B readUInt32LE: ${b.readUInt32LE(offA)}`);

// Look at B more carefully — maybe the byte sequence is shifted?
console.log(`\n=== A 32 bytes around 0x103280 ===`);
for (let i = 0x103280; i < 0x103280 + 32; i++) {
  process.stdout.write(a[i].toString(16).padStart(2,'0') + ' ');
}
console.log();
console.log(`=== B 32 bytes around 0x103280 ===`);
for (let i = 0x103280; i < 0x103280 + 32; i++) {
  process.stdout.write(b[i].toString(16).padStart(2,'0') + ' ');
}
console.log();

// And around index 156,0:
const offB = matStart + 156 * 239 * stride;
console.log(`\n[156][0] byte offset = 0x${offB.toString(16)}`);
console.log(`Expected flip2 = 0xa775de, computed = 0x${offB.toString(16)}`);
console.log(`A: ${a.slice(offB, offB + 16).toString('hex')}`);
console.log(`B: ${b.slice(offB, offB + 16).toString('hex')}`);
