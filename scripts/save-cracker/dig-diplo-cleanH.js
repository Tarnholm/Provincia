// Session 32 step H: check the matrix more carefully.
// Each record's first 16 bytes contain: u32 prev_enum, u32 zero, u32 curr_enum, u32 zero.
// Then sig at +16: u32=10, u32=200, u32=200, u32=2, u32=6, u32=200 (default).
// Let's tabulate (prev, curr) per cell.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const a = fs.readFileSync(path.join(SAVES, 'save_1.1.sav'));
const b = fs.readFileSync(path.join(SAVES, 'save_2.1.sav'));

const stride = 267;
const matStart = 0xf8fd2;
const N = 239;

function cell(buf, r, c) {
  const off = matStart + (r * N + c) * stride;
  return {
    prev: buf.readUInt32LE(off + 0),
    f4:   buf.readUInt32LE(off + 4),
    curr: buf.readUInt32LE(off + 8),
    f12:  buf.readUInt32LE(off + 12),
    sig0: buf.readUInt32LE(off + 16),  // expected 10
    sig1: buf.readUInt32LE(off + 20),  // expected 200
    sig2: buf.readUInt32LE(off + 24),  // expected 200
    sig3: buf.readUInt32LE(off + 28),  // expected 2
    sig4: buf.readUInt32LE(off + 32),  // expected 6
    sig5: buf.readUInt32LE(off + 36),  // expected 200
    raw: buf.slice(off, off + 64),
  };
}

// 1. Distribution of (prev, curr) tuples in A.
const tupHist = {};
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const cl = cell(a, r, c);
    const k = `${cl.prev},${cl.curr}`;
    tupHist[k] = (tupHist[k] || 0) + 1;
  }
}
console.log(`(prev,curr) histogram in A:`);
const top = Object.entries(tupHist).sort((x, y) => y[1] - x[1]).slice(0, 20);
for (const [k, c] of top) console.log(`  (${k}): ${c}`);

// 2. Same for B.
const tupHistB = {};
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const cl = cell(b, r, c);
    const k = `${cl.prev},${cl.curr}`;
    tupHistB[k] = (tupHistB[k] || 0) + 1;
  }
}
console.log(`\n(prev,curr) histogram in B:`);
const topB = Object.entries(tupHistB).sort((x, y) => y[1] - x[1]).slice(0, 20);
for (const [k, c] of topB) console.log(`  (${k}): ${c}`);

// 3. Print Romans Julii row (r=0): all 239 cells.
console.log(`\n=== Romans Julii (r=0) ALL 239 cells (in A): ===`);
for (let c = 0; c < N; c++) {
  const cl = cell(a, 0, c);
  const altered = (cl.prev !== 5 || cl.curr !== 0) ? '   <-- non-default' : '';
  if (cl.prev !== 5 || cl.curr !== 0) {
    console.log(`  [0][${c}] prev=${cl.prev} curr=${cl.curr} f4=${cl.f4} f12=${cl.f12}${altered}`);
  }
}
console.log(`\n=== Romans Julii (r=0) ALL 239 cells (in B): ===`);
for (let c = 0; c < N; c++) {
  const cl = cell(b, 0, c);
  if (cl.prev !== 5 || cl.curr !== 0) {
    console.log(`  [0][${c}] prev=${cl.prev} curr=${cl.curr} f4=${cl.f4} f12=${cl.f12}`);
  }
}

// 4. Check the sig values for the (0,156) cell — did any other fields change?
console.log(`\n=== Full record bytes [0][156] ===`);
const r0 = cell(a, 0, 156);
const rB = cell(b, 0, 156);
console.log(`A: ${r0.raw.toString('hex')}`);
console.log(`B: ${rB.raw.toString('hex')}`);
// Sig fields:
console.log(`A: prev=${r0.prev} f4=${r0.f4} curr=${r0.curr} f12=${r0.f12} sig=[${r0.sig0},${r0.sig1},${r0.sig2},${r0.sig3},${r0.sig4},${r0.sig5}]`);
console.log(`B: prev=${rB.prev} f4=${rB.f4} curr=${rB.curr} f12=${rB.f12} sig=[${rB.sig0},${rB.sig1},${rB.sig2},${rB.sig3},${rB.sig4},${rB.sig5}]`);

// 5. Full bytes of [156][0]:
console.log(`\n=== Full record bytes [156][0] ===`);
const x0 = cell(a, 156, 0);
const xB = cell(b, 156, 0);
console.log(`A: ${x0.raw.toString('hex')}`);
console.log(`B: ${xB.raw.toString('hex')}`);
