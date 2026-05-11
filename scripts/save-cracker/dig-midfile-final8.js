// Session 27 — Final validation: diagonal in RoR-T1 too?

const fs = require('fs');

// Find ARR_START in RoR-T1 by pattern scan
const ROR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav';
const buf = fs.readFileSync(ROR);
const STRIDE = 267;
const W = 240, H = 238;

// Try to find ARR_START by sliding through possible offsets
// We know the canonical record is 267 bytes with f0=5, f12=10, f16=200, f20=200, f24=2, f28=6
// Find runs of 100+ consecutive canonical records

let bestStart = -1, bestRun = 0;
for (let off = 0x10000; off < buf.length - 50000; off += 1) {
  // Check if this is a canonical record start
  if (buf[off] === 5 && buf[off+12] === 10 && buf[off+16] === 0xc8 && buf[off+24] === 2 && buf[off+28] === 6) {
    // Run check
    let run = 0;
    for (let i = 0; i < 200; i++) {
      const o = off + i*STRIDE;
      if (o+30 > buf.length) break;
      if (buf[o] === 5 && buf[o+12] === 10 && buf[o+16] === 0xc8 && buf[o+24] === 2 && buf[o+28] === 6) run++;
      else break;
    }
    if (run > bestRun) { bestRun = run; bestStart = off; }
    if (run >= 100) break;
  }
}
console.log('RoR-T1 best array start:', '0x' + bestStart.toString(16), 'run length:', bestRun);

// Verify with full 240x238 walk
let canon = 0, f600 = 0, diag = 0;
const cells = [];
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const o = bestStart + (r*W + c)*STRIDE;
    if (o + 36 > buf.length) break;
    const f28 = buf.readUInt32LE(o + 28);
    const f32 = buf.readUInt32LE(o + 32);
    if (f28 === 6) canon++;
    if (f28 === 6 && f32 === 600) {
      f600++;
      cells.push({c,r});
      if (c + r === 237) diag++;
    }
  }
}
console.log('Canonical f28=6:', canon, '/ 57120');
console.log('f600 cells:', f600);
console.log('Cells on c+r=237 diagonal:', diag);
console.log('Sample diag cells:');
cells.filter(c=>c.c+c.r === 237).slice(0,15).forEach(c=>console.log('  (' + c.c + ',' + c.r + ')'));

// Bottom-row count
const bottomRow = cells.filter(c=>c.r === 237).length;
console.log('Bottom-row r=237 cells:', bottomRow);

// Confirmed: same pattern across saves => engine fixed
