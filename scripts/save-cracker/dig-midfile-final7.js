// Session 27 — Both arrays found? Verify ARR_START in rome10.

const fs = require('fs');
const SAV = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const buf = fs.readFileSync(SAV);

// Compare 0xf8fd2 vs 0x138596 — which is correct?
const STRIDE = 267;
const W = 240, H = 238;

// Method 1: search for ALL instances of the canonical pattern
const pattern = Buffer.from('0500000000000000000000000a000000c8000000c8000000020000000600000000', 'hex');
let hits = [];
for (let off = 0; off < buf.length - pattern.length; off++) {
  let m = true;
  for (let j = 0; j < pattern.length; j++) {
    if (buf[off+j] !== pattern[j]) { m = false; break; }
  }
  if (m) hits.push(off);
}
console.log('Pattern hits in rome10:', hits.length);
console.log('First 15 hits:');
hits.slice(0,15).forEach(o=>console.log('  0x' + o.toString(16)));

// 0xf8fd2 - 0xf8fd2 mod STRIDE = ?
console.log('\n0xf8fd2 mod 267:', 0xf8fd2 % STRIDE);
console.log('0x138596 mod 267:', 0x138596 % STRIDE);

// Sample the bytes at 0xf8fd2
console.log('\nBytes at 0xf8fd2:');
const b1 = buf.subarray(0xf8fd2, 0xf8fd2 + 60);
console.log('  ' + Array.from(b1).map(b=>b.toString(16).padStart(2,'0')).join(' '));

console.log('\nBytes at 0x138596:');
const b2 = buf.subarray(0x138596, 0x138596 + 60);
console.log('  ' + Array.from(b2).map(b=>b.toString(16).padStart(2,'0')).join(' '));

// Verify session 22's array at 0xf8fd2 is the correct one
// Walk 240×238 records and check canonicality
const ARR1 = 0xf8fd2;
let canon1 = 0;
for (let i = 0; i < W*H; i++) {
  const o = ARR1 + i * STRIDE;
  if (o + 36 > buf.length) break;
  const f28 = buf.readUInt32LE(o + 28);
  if (f28 === 6) canon1++;
}
console.log('\nARR_START=0xf8fd2: canonical f28=6 cells:', canon1, '/ 57120');

const ARR2 = 0x138596;
let canon2 = 0;
for (let i = 0; i < W*H; i++) {
  const o = ARR2 + i * STRIDE;
  if (o + 36 > buf.length) break;
  const f28 = buf.readUInt32LE(o + 28);
  if (f28 === 6) canon2++;
}
console.log('ARR_START=0x138596: canonical f28=6 cells:', canon2, '/ 57120');

// Whichever has more canonical hits is the real start
// Recompute the diagonal with the original ARR_START=0xf8fd2 and 240x238 grid
// Also try other grid shapes
console.log('\n=== Try several grid shapes at ARR_START=0xf8fd2 ===');
for (const [w, h] of [[240,238],[238,240],[239,239],[240,240],[238,238]]) {
  let canonCount = 0;
  let f600 = 0;
  let diagSum = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const o = ARR1 + (r*w + c)*STRIDE;
      if (o + 36 > buf.length) break;
      const f28 = buf.readUInt32LE(o + 28);
      const f32 = buf.readUInt32LE(o + 32);
      if (f28 === 6) canonCount++;
      if (f28 === 6 && f32 === 600) {
        f600++;
        if (Math.abs(c + r - 237) <= 2) diagSum++;
      }
    }
  }
  console.log('  W=' + w + ' H=' + h + ': canon=' + canonCount + ' f600=' + f600 + ' on diag=' + diagSum);
}

// So 240x238 = 57120 yields ~56400 canonical, 697 f600
// Let me confirm sessions 18 and 22 are aligned

// Also retry the diagonal sum stat with this 240x238 confirmation
const ARR_START = 0xf8fd2;
console.log('\n=== Diagonal cells in rome10 (ARR=0xf8fd2, W=240, H=238) ===');
const diagCells = [];
const allF600 = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const o = ARR_START + (r*W + c)*STRIDE;
    const f28 = buf.readUInt32LE(o + 28);
    const f32 = buf.readUInt32LE(o + 32);
    if (f28 === 6 && f32 === 600) {
      allF600.push({c, r});
      if (c + r === 237) diagCells.push({c, r});
    }
  }
}
console.log('Total f600 cells:', allF600.length);
console.log('Cells on c+r=237:', diagCells.length);
const sample = diagCells.slice(0, 30);
console.log('Sample:', sample.map(c=>'('+c.c+','+c.r+')').join(','));
