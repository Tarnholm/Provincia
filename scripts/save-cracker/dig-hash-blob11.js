// Session 23: hash blob #11 — work the structure backward.
// The 239-faction array's header is at 0x1f442de. What's before it?
// And: maybe the "0xef" markers are the section terminators / type tags.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// Dump wider region 0x1f437c0..0x1f442f0
console.log(`=== Wide dump 0x1f437c0..0x1f442f0 ===`);
for (let off = 0x1f437c0; off < 0x1f442f0; off += 16) {
  const slice = buf.subarray(off, off + 16);
  const hex = slice.toString('hex').match(/.{2}/g).join(' ');
  const ascii = Array.from(slice).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
  // Check for self-pointer at this offset
  const sp = buf.readUInt32LE(off);
  const isSelf = sp === off ? ' *SELF*' : '';
  console.log(`  0x${off.toString(16)}: ${hex}  ${ascii}${isSelf}`);
}

// Find ALL self-pointers in 0x1f43500..0x1f47ac0
console.log(`\n=== All self-pointers in 0x1f43500..0x1f47ac0 ===`);
const selfPtrs = [];
for (let off = 0x1f43500; off < 0x1f47ac0 - 4; off++) {
  if (buf.readUInt32LE(off) === off) {
    selfPtrs.push(off);
  }
}
console.log(`Total: ${selfPtrs.length}`);
for (const sp of selfPtrs) {
  const v4 = buf.readUInt32LE(sp + 4);
  const ctx = buf.subarray(Math.max(0, sp - 16), sp + 32).toString('hex');
  console.log(`  0x${sp.toString(16)} (+4 u32 = ${v4} = 0x${v4.toString(16)})`);
}
