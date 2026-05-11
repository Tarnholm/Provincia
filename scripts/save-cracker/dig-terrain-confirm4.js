// Session 22: examine the perfect diagonal of f20==600 / f32==600.
// 192/256 = 75% of f20==600 cells are on a perfect anti-diagonal (idx diff = 239 = W-1).
// This isn't terrain — it's a structural line through the array.
//
// Could be: (a) initial-fog-of-war boundary, (b) a turn-N-AI exploration front,
// (c) a feature/marker line. Let me find the actual line in (c,r) space.

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
      f20: buf.readUInt32LE(off + 20),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
    });
  }
}

// Print all f20==600 cells in (c, r) order (sorted by r then c)
const f20_600 = cells.filter(c => c.c !== 239 && c.r !== 237 && c.f20 === 600);
console.log(`f20==600: ${f20_600.length} cells`);
console.log('  c+r per cell (r increasing down):');
const byRow = new Map();
for (const c of f20_600) {
  if (!byRow.has(c.r)) byRow.set(c.r, []);
  byRow.get(c.r).push(c.c);
}
const rows = [...byRow.keys()].sort((a,b) => a - b);
for (const r of rows) {
  const cs = byRow.get(r).sort((a,b)=>a-b);
  console.log(`  r=${r}: cs=${cs.join(',')} (cnt=${cs.length}, c+r=${cs.map(c=>c+r).join(',')})`);
}

// Same for f32==600
console.log(`\nf32==600: ${cells.filter(c => c.c !== 239 && c.r !== 237 && c.f32 === 600).length} cells`);
const f32_600 = cells.filter(c => c.c !== 239 && c.r !== 237 && c.f32 === 600);
const byRow32 = new Map();
for (const c of f32_600) {
  if (!byRow32.has(c.r)) byRow32.set(c.r, []);
  byRow32.get(c.r).push(c.c);
}
console.log(`  By row (showing min,max,count):`);
for (const r of [...byRow32.keys()].sort((a,b)=>a-b)) {
  const cs = byRow32.get(r).sort((a,b)=>a-b);
  const cPlusR = cs.map(c=>c+r);
  console.log(`  r=${r}: min(c)=${cs[0]} max(c)=${cs[cs.length-1]} cnt=${cs.length}  c+r range=[${Math.min(...cPlusR)}..${Math.max(...cPlusR)}]`);
}
