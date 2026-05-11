// Session 22: prove the c+r=237 sentinel structure of the mid-file array.
// This refutes the "terrain grid" interpretation from session 21.
//
// The grid is 240*238 records. If the array is positionally organized,
// what IS the meaningful structure? Test hypotheses:
//   (a) c+r=237 is a hardcoded sentinel anti-diagonal
//   (b) The values 200, 600, 0, -10 form a specific pattern
//   (c) Other variant cells form different shapes

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240;
const H = 238;

const buf = fs.readFileSync(SAVE);

const cells = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const idx = r * W + c;
    const off = ARR_START + idx * STRIDE;
    cells.push({
      idx, c, r,
      f0:  buf.readUInt32LE(off),
      f4:  buf.readUInt32LE(off + 4),
      f8:  buf.readUInt32LE(off + 8),
      f12: buf.readUInt32LE(off + 12),
      f16: buf.readUInt32LE(off + 16),
      f20: buf.readUInt32LE(off + 20),
      f24: buf.readUInt32LE(off + 24),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
      f68: buf.readUInt32LE(off + 68),
      f84: buf.readUInt32LE(off + 84),
      f96: buf.readUInt32LE(off + 96),
    });
  }
}

// Sanity: how many cells have c+r=237 (anti-diagonal)?
console.log('=== Anti-diagonal sentinel analysis ===');
const ad = cells.filter(c => c.c + c.r === 237);
console.log(`Total cells with c+r=237: ${ad.length} (theoretical: 238 if all rows match)`);

// Count by f20 value among anti-diagonal cells
const ad_f20 = new Map();
for (const c of ad) ad_f20.set(c.f20, (ad_f20.get(c.f20) || 0) + 1);
console.log(`  f20 hist on anti-diagonal: ${[...ad_f20.entries()].map(([k,v]) => `${k}:${v}`).join(', ')}`);

// Count by f32 value
const ad_f32 = new Map();
for (const c of ad) ad_f32.set(c.f32, (ad_f32.get(c.f32) || 0) + 1);
console.log(`  f32 hist on anti-diagonal: ${[...ad_f32.entries()].map(([k,v]) => `${k}:${v}`).join(', ')}`);

// Now check off-diagonal: cells with c+r != 237 and 239 (full diag has r=237, c=2)
console.log(`\n=== Off-diagonal interior cells ===`);
const od = cells.filter(c => c.c !== 239 && c.r !== 237 && (c.c + c.r) !== 237);
console.log(`Total off-anti-diagonal interior: ${od.length}`);
const od_f20 = new Map();
for (const c of od) od_f20.set(c.f20, (od_f20.get(c.f20) || 0) + 1);
const od_f32 = new Map();
for (const c of od) od_f32.set(c.f32, (od_f32.get(c.f32) || 0) + 1);
const od_f28 = new Map();
for (const c of od) od_f28.set(c.f28, (od_f28.get(c.f28) || 0) + 1);
console.log(`  f20 hist: ${[...od_f20.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}:${v}`).join(', ')}`);
console.log(`  f28 hist: ${[...od_f28.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}:${v}`).join(', ')}`);
console.log(`  f32 hist: ${[...od_f32.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}:${v}`).join(', ')}`);

// Among off-diagonal cells, what is the variant histogram?
console.log(`\n=== Off-diagonal variant key histogram ===`);
const vh = new Map();
for (const c of od) {
  const k = `${c.f16}_${c.f20}_${c.f24}_${c.f28}_${c.f32}`;
  vh.set(k, (vh.get(k) || 0) + 1);
}
for (const [k, n] of [...vh.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15)) {
  console.log(`  ${k}: ${n}`);
}

// Now dump the actual interior non-canon cells excluding the anti-diagonal
const oi = od.filter(c => !(c.f16 === 200 && c.f20 === 200 && c.f24 === 2 && c.f28 === 6 && c.f32 === 200));
console.log(`\nInterior off-anti-diagonal non-canon: ${oi.length}`);
const oi_byrow = new Map();
for (const c of oi) {
  if (!oi_byrow.has(c.r)) oi_byrow.set(c.r, []);
  oi_byrow.get(c.r).push(c);
}
console.log(`  Distinct rows: ${oi_byrow.size}`);
// Print 10 sample interior non-canon cells with their values
console.log(`\n=== Sample 30 interior off-anti-diagonal non-canon cells ===`);
for (const c of oi.slice(0, 30)) {
  console.log(`  (${c.c.toString().padStart(3)},${c.r.toString().padStart(3)})  f16=${c.f16} f20=${c.f20} f24=${c.f24} f28=${c.f28} f32=${c.f32}`);
}
