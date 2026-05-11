// Session 23: hash blob #9 — decode the 239th record (which has a self-pointer at +8)
// and walk section headers from 0x1f451ea forward.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAVE);

// 239th record at 0x1f451ce
console.log(`=== 239th record (the "different" one) at 0x1f451ce..0x1f451ea ===`);
const r239 = buf.subarray(0x1f451ce, 0x1f451ea + 32);
console.log(`  Bytes 0x1f451ce..0x1f451ee: ${r239.subarray(0, 0x1f451ee - 0x1f451ce).toString('hex')}`);
// Interpret fields
console.log(`  +0   u32 = ${buf.readUInt32LE(0x1f451ce)} (= 3, same as others)`);
console.log(`  +4   u32 = ${buf.readUInt32LE(0x1f451d2)}`);
console.log(`  +8   u32 = 0x${buf.readUInt32LE(0x1f451d6).toString(16)} ${buf.readUInt32LE(0x1f451d6) === 0x1f451d6 ? '(SELF-POINTER, valid section header)' : '(not self-ptr)'}`);
console.log(`  +12  u32 = ${buf.readUInt32LE(0x1f451da)}`);
console.log(`  +16  u32 = 0x${buf.readUInt32LE(0x1f451de).toString(16)} = ${buf.readUInt32LE(0x1f451de)}`);
console.log(`  +20  u32 = 0x${buf.readUInt32LE(0x1f451e2).toString(16)} (float = ${buf.readFloatLE(0x1f451e2)})`);
console.log(`  +24  u32 = 0x${buf.readUInt32LE(0x1f451e6).toString(16)} = ${buf.readUInt32LE(0x1f451e6)}`);

// Section at 0x1f451d6 (selfPtr)
const s1Start = 0x1f451d6;
const s1Self = buf.readUInt32LE(s1Start);
const s1Size = buf.readUInt32LE(s1Start + 4);
console.log(`\nSection candidate at 0x${s1Start.toString(16)}: self=0x${s1Self.toString(16)}, size=${s1Size} (0x${s1Size.toString(16)})`);
console.log(`  Valid? ${s1Self === s1Start && s1Size > 0 && s1Size < 10_000_000 ? 'YES' : 'NO'}`);
if (s1Self === s1Start && s1Size > 0 && s1Size < 10_000_000) {
  console.log(`  Section ends at 0x${(s1Start + s1Size).toString(16)}`);
}

// Section at 0x1f451ea
const s2Start = 0x1f451ea;
const s2Self = buf.readUInt32LE(s2Start);
const s2Size = buf.readUInt32LE(s2Start + 4);
console.log(`Section candidate at 0x${s2Start.toString(16)}: self=0x${s2Self.toString(16)}, size=${s2Size} (0x${s2Size.toString(16)})`);
console.log(`  Valid? ${s2Self === s2Start && s2Size > 0 && s2Size < 10_000_000 ? 'YES' : 'NO'}`);
if (s2Self === s2Start && s2Size > 0 && s2Size < 10_000_000) {
  console.log(`  Section ends at 0x${(s2Start + s2Size).toString(16)}`);
}

// Walk sections forward from each plausible start
function walkSections(start, label, maxN = 30) {
  console.log(`\n=== Section walk from 0x${start.toString(16)} (${label}) ===`);
  let pp = start;
  for (let i = 0; i < maxN && pp + 8 < buf.length; i++) {
    const sp = buf.readUInt32LE(pp);
    const sz = buf.readUInt32LE(pp + 4);
    if (sp !== pp || sz < 8 || sz > 10_000_000) {
      console.log(`  [${i}] @ 0x${pp.toString(16)}: BROKEN (self=0x${sp.toString(16)}, size=${sz})`);
      console.log(`      bytes: ${buf.subarray(pp, pp + 32).toString('hex')}`);
      return;
    }
    // Look for embedded UTF-16LE strings near start
    const peek = buf.subarray(pp + 8, Math.min(pp + Math.min(sz, 64), buf.length));
    const ascii = Array.from(peek).map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
    console.log(`  [${i}] @ 0x${pp.toString(16)}: size=${sz} end=0x${(pp+sz).toString(16)} peek="${ascii}"`);
    pp += sz;
  }
}

walkSections(s2Start, "after value=3 array");

// Also explore: is the high-entropy zone (0x1f43898..0x1f441a0) part of a section?
// Check for section header near its start
console.log(`\n=== Scan forward from 0x1f43500 for self-pointer headers ===`);
let hits = 0;
for (let pp = 0x1f43500; pp < 0x1f47abd && hits < 30; pp++) {
  const sp = buf.readUInt32LE(pp);
  if (sp === pp) {
    const sz = buf.readUInt32LE(pp + 4);
    if (sz >= 8 && sz < 5_000_000 && pp + sz < buf.length) {
      console.log(`  Self-pointer @ 0x${pp.toString(16)}: size=${sz} (end=0x${(pp+sz).toString(16)})`);
      hits++;
    }
  }
}
console.log(`Total self-pointer candidates: ${hits}`);
