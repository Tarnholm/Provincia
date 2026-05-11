// dig-gap9.js — confirm 240-period structure (likely map width)
const fs = require('fs');
const path = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav';
const buf = fs.readFileSync(path);

const REC_START = 0x633c50;
const STRIDE = 267;
const N = 36582;

// Test exact period 240
const nonDefault = [];
for (let i = 0; i < N; i++) {
  const a = buf.readUInt32LE(REC_START + i * STRIDE + 20);
  const b = buf.readUInt32LE(REC_START + i * STRIDE + 28);
  const c = buf.readUInt32LE(REC_START + i * STRIDE + 32);
  if (b === 0x36) nonDefault.push({ i, a, b, c });  // B=0x36 records only
}
console.log(`${nonDefault.length} B=0x36 records`);
// Are their indices i ≡ k (mod 240) for some constant k?
const mod240 = {};
for (const r of nonDefault) {
  const k = r.i % 240;
  mod240[k] = (mod240[k]||0)+1;
}
const top240 = Object.entries(mod240).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log(`top (i mod 240) values for B=0x36 records: ${top240.map(([k,c])=>`${k}×${c}`).join(', ')}`);

// Test all moduli 230..250 to find best
console.log(`\nbest modulus search (i % p for B=0x36 records):`);
for (let p = 230; p <= 250; p++) {
  const m = {};
  for (const r of nonDefault) m[r.i%p] = (m[r.i%p]||0)+1;
  const max = Math.max(...Object.values(m));
  const distinctK = Object.values(m).filter(v => v >= 0.3 * max).length;
  console.log(`  p=${p}: max bucket=${max}, distinct dominant k = ${distinctK}, mean=${(nonDefault.length/p).toFixed(1)}`);
}

// What about i % 153 (height direction)?
console.log(`\nheight test (i / 240 % 153):`);
for (const r of nonDefault.slice(0, 12)) {
  console.log(`  i=${r.i} → row=${Math.floor(r.i/240)}, col=${r.i%240}`);
}

// Show ALL nonDefault for B=0x36 with their (row, col) interpretation
console.log(`\nfirst 30 B=0x36 records as (col, row) using width 240:`);
nonDefault.slice(0, 30).forEach(r => {
  const col = r.i % 240;
  const row = Math.floor(r.i / 240);
  console.log(`  i=${r.i.toString().padStart(6)}  col=${col.toString().padStart(3)}  row=${row.toString().padStart(3)}`);
});

// Now do the same for B=0x37 (only 11 records)
console.log(`\nB=0x37 records (11):`);
const b37 = [];
for (let i = 0; i < N; i++) {
  if (buf.readUInt32LE(REC_START + i * STRIDE + 28) === 0x37) b37.push(i);
}
for (const i of b37) {
  console.log(`  i=${i}  col=${i%240}  row=${Math.floor(i/240)}`);
}

// Are there 240 × ROWS = N? With N=36582 and 240: 36582/240 = 152.425 → not even.
// Try 36582 = 153 × 240 - 18 → off by 18. Or 152 × 240 + 102 = 36582. Hmm.
// Maybe map is 240 wide × 153 high = 36720 total. The actual N=36582 means file ends
// 138 records short of a full 240×153 grid? Or the actual grid is slightly different.

// Check: is N actually 36582 or something else? The "record" boundary in dig-gap5 was based on
// dig-gap3's interior zero-runs. Let me extend further to find exact end of uniform records.
// Scan all 36644 possible records (0..36644-1) and test: bytes 36..95 must be all zero AND bytes 100..266 must be all zero.
let lastGood = -1;
for (let i = 0; i < 36644; i++) {
  const rs = REC_START + i * STRIDE;
  if (rs + STRIDE > buf.length) break;
  let ok = true;
  for (let j = 36; j < 96; j++) if (buf[rs+j] !== 0) { ok = false; break; }
  if (ok) for (let j = 100; j < 267; j++) {
    // 100..266 should be all zero except +84 (=0x240) and +96 (=0xa6) which are in the "fixed" zone
    if (buf[rs+j] !== 0) { ok = false; break; }
  }
  if (ok) lastGood = i;
  else break;
}
console.log(`\nLast uniform record by zero-mask check: i=${lastGood}`);
console.log(`Records 0..${lastGood} are uniform 267-byte tile-attribute structures.`);

// What's at the records just AFTER lastGood?
console.log(`\n=== records ${lastGood+1}..${lastGood+5} (boundary): ===`);
for (let i = lastGood+1; i <= lastGood+5; i++) {
  const rs = REC_START + i * STRIDE;
  const slice = buf.slice(rs, rs + 64);
  const hex = Array.from(slice).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const asc = Array.from(slice).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
  console.log(`rec ${i} @ 0x${rs.toString(16)}:`);
  console.log(`  hex: ${hex}`);
  console.log(`  asc: ${asc}`);
}
