// dig-gap6.js — characterize the record fields and the gap tail.
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const REC_START = 0x633c50;
const STRIDE = 267;
const N = 36582;

// 1) Per-byte variance across all records (which byte offsets within the 267-byte record vary?)
const distinctVals = new Array(STRIDE).fill(null).map(() => new Set());
for (let i = 0; i < N; i++) {
  const rs = REC_START + i * STRIDE;
  for (let j = 0; j < STRIDE; j++) {
    distinctVals[j].add(buf[rs + j]);
  }
}
console.log(`per-byte distinct-value counts within 267-byte record:`);
console.log(`(only bytes with >1 distinct value)`);
for (let j = 0; j < STRIDE; j++) {
  if (distinctVals[j].size > 1) {
    const vals = [...distinctVals[j]].sort((a,b)=>a-b).slice(0,8).map(v => v.toString(16).padStart(2,'0'));
    console.log(`  byte ${j.toString().padStart(3)} (${distinctVals[j].size} distinct): ${vals.join(' ')}${distinctVals[j].size > 8 ? '...' : ''}`);
  }
}

// 2) The fixed-value bytes — print their values
console.log(`\nfixed bytes (same in all 36582 records):`);
let runStart = -1;
for (let j = 0; j < STRIDE; j++) {
  if (distinctVals[j].size === 1) {
    if (runStart < 0) runStart = j;
  } else {
    if (runStart >= 0) {
      const slice = buf.slice(REC_START + runStart, REC_START + j);
      const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
      console.log(`  bytes ${runStart}..${j-1}: ${hex}`);
      runStart = -1;
    }
  }
}
if (runStart >= 0) {
  const slice = buf.slice(REC_START + runStart, REC_START + STRIDE);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  console.log(`  bytes ${runStart}..${STRIDE-1}: ${hex}`);
}

// 3) Decode header structure: bytes 0..16 always 05 00 00 00 00 00 00 00 00 00 00 00 0a 00 00 00 — probably (u32 type=5, u32 0, u32 0, u32 10)
// Then 0c00 = u32 12 of variable

// Check u32 fields by offset
console.log(`\n=== u32 field analysis (within record body, all 36582 records) ===`);
for (let off = 0; off < STRIDE - 4; off += 4) {
  const vals = new Map();
  for (let i = 0; i < N; i++) {
    const v = buf.readUInt32LE(REC_START + i * STRIDE + off);
    vals.set(v, (vals.get(v)||0)+1);
  }
  if (vals.size === 1) {
    const v = [...vals.keys()][0];
    console.log(`  +${off.toString().padStart(3)} const u32 = 0x${v.toString(16).padStart(8,'0')} (${v})`);
  } else if (vals.size <= 12) {
    const top = [...vals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
    console.log(`  +${off.toString().padStart(3)} u32 ${vals.size} distinct: ${top.map(([v,c])=>`0x${v.toString(16)}×${c}`).join(', ')}`);
  } else {
    console.log(`  +${off.toString().padStart(3)} u32 ${vals.size} distinct (high variance)`);
  }
}

// 4) Investigate the gap tail — what comes after record 36581 (the last full record)?
// Last full record ends at 0xf885d1 + 267 = 0xf886dc, but gap end is 0xf88637 (slightly earlier).
// User said gap end is 0xf88637 — but our records extrapolate to 0xf886dc... actually we computed records to span 0x633c50..0xf885d1+267=0xf886dc.
// Wait, let me re-check the END boundary. The gap end 0xf88637 may be a slightly different cut.

// Show bytes around the gap end 0xf88637
console.log(`\n=== bytes 0xf84600..0xf88700 (gap-tail transition) ===`);
for (let p = 0xf84600; p < 0xf88700; p += 64) {
  const slice = buf.slice(p, Math.min(p + 64, buf.length));
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(`0x${p.toString(16)}  ${hex.slice(0,96)}  ${asc.slice(0,32)}`);
}
