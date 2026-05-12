// dig-board5.js — closer look at ship record and find diplomat's position record

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A6 = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));
const B7 = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// Find diplomat character record. Originally it should be on a land tile.
// Hint from session 36: per-character region 0x1504eb9-ish for a diplomat (Romans).
// And there should be a position record where coords changed from <land tile> → (99, 171).

// 0x01573848 changed 0→99. Look at it.
const candidates = [0x01573848, 0x0157bad0, 0x0157d9d4, 0x015b1764, 0x015b7ae8, 0x015ba7e0, 0x016318b0, 0x01642d80, 0x0164ae60];
for (const off of candidates) {
  console.log(`\n=== ${hex(off)} (-32..+64) ===`);
  const lo = off - 32;
  const hi = off + 64;
  console.log(`A6: ${A6.subarray(lo, hi).toString('hex')}`);
  console.log(`B7: ${B7.subarray(lo, hi).toString('hex')}`);
  // Look at aligned u32s
  for (let i = (off - 32) & ~3; i < off + 32; i += 4) {
    const a = A6.readUInt32LE(i);
    const b = B7.readUInt32LE(i);
    if (a !== b) {
      console.log(`  ${hex(i)}: ${a} → ${b}  (signed: ${A6.readInt32LE(i)} → ${B7.readInt32LE(i)})`);
    }
  }
}

// Find paired (X→99, Y→171) where prior X, Y look like land coords (not 0, not 99/171)
console.log('\n\n=== Looking for land→ship position transitions: (X∈[1..200], Y∈[1..150]) → (171, 99) ===');
const N = A6.length;
for (let i = 0; i < N - 12; i += 4) {
  const a1 = A6.readUInt32LE(i);
  const b1 = B7.readUInt32LE(i);
  if (b1 !== 171 && b1 !== 99) continue;
  if (a1 === b1 || a1 > 300 || a1 < 1) continue;
  // Check 4-12B later
  for (const d of [4, 8, 12, 16, 20]) {
    if (i + d + 4 >= N) continue;
    const a2 = A6.readUInt32LE(i + d);
    const b2 = B7.readUInt32LE(i + d);
    if (a2 === b2 || a2 > 300 || a2 < 1) continue;
    if ((b1 === 99 && b2 === 171) || (b1 === 171 && b2 === 99)) {
      console.log(`  ${hex(i)} ${a1}→${b1}  +  ${hex(i + d)} ${a2}→${b2}  d=${d}`);
    }
  }
}
