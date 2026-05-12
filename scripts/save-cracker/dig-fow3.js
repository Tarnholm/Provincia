// dig-fow3.js — characterize the 4 changed bytes precisely

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_8.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_9.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');

// Per-byte breakdown of every diff
const diffs = [];
for (let i = 0; i < A.length; i++) {
  if (A[i] !== B[i]) diffs.push({ off: i, a: A[i], b: B[i] });
}
console.log(`Total per-byte diffs: ${diffs.length}`);
for (const d of diffs) {
  console.log(`  ${hex(d.off)}: ${d.a.toString(16).padStart(2,'0')} → ${d.b.toString(16).padStart(2,'0')}  (dec ${d.a} → ${d.b})`);
}

// Show u16 / u32 readings centered on each diff
console.log('\n=== u16/u32 alignment views ===');
for (const d of diffs) {
  const u16A = A.readUInt16LE(d.off & ~1);
  const u16B = B.readUInt16LE(d.off & ~1);
  const u32a_lo = d.off & ~3;
  const u32A = A.readUInt32LE(u32a_lo);
  const u32B = B.readUInt32LE(u32a_lo);
  console.log(`  ${hex(d.off)}: u16@${hex(d.off & ~1)} = ${u16A} → ${u16B} ; u32@${hex(u32a_lo)} = ${u32A} → ${u32B}`);
}

// What is at 0x43f8? Check session 32 says "RNG counter" — verify with bytes around
// 0x43f4 = u32(1), 0x43f8 = u32(4670/6062) "turn-ish counter"
// 0x44e2 = ??? — sits inside what looks like a header u32 array
// 0x02110de5 — Lua

// Hypothesis check: 0x44e2 may be the toggle_fow flag (1=on, 0=off)
// Need a SECOND pair to confirm. Check it against earlier save pairs in this corpus.

// Compare save_5.2..save_8.2 byte 0x44e2
const saves = ['save_1.2.sav', 'save_2.2.sav', 'save_3.2.sav', 'save_4.2.sav', 'save_5.2.sav', 'save_6.2.sav', 'save_7.2.sav', 'save_8.2.sav', 'save_9.2.sav'];
console.log('\n=== Byte 0x44e2 + 0x02110de5 across the full ladder ===');
for (const s of saves) {
  try {
    const buf = fs.readFileSync(path.join(SAVES, s));
    if (buf.length < 0x02110de8) {
      console.log(`  ${s} (${buf.length}B): too small`);
      continue;
    }
    const b44e2 = buf[0x44e2];
    const b210 = buf[0x02110de5];
    const u32_43f8 = buf.readUInt32LE(0x43f8);
    console.log(`  ${s} (${buf.length}B): 0x44e2=${b44e2.toString(16)} 0x02110de5=${b210.toString(16)} 0x43f8u32=${u32_43f8}`);
  } catch (e) {
    console.log(`  ${s}: ${e.message}`);
  }
}
