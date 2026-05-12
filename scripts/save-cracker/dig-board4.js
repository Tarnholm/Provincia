// dig-board4.js — for diplomat board, find position records where the coord
// changed to (171,99) — same as ship's position in save_6.2.

const fs = require('fs');
const path = require('path');

const SAVES = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVES, 'save_6.2.sav'));
const B = fs.readFileSync(path.join(SAVES, 'save_7.2.sav'));

const hex = (x) => '0x' + x.toString(16).padStart(8, '0');
const N = A.length;

// Find any byte that goes from <val_a> to 99 (0x63) or 171 (0xab)
// — the ship's current coord (target tile after boarding)
console.log('=== Looking for u32s that BECAME 99 or 171 in save_7.2 ===');
const becomeShipCoord = [];
for (let i = 0; i < N - 4; i += 4) {
  const a = A.readUInt32LE(i);
  const b = B.readUInt32LE(i);
  if (a === b) continue;
  if (b === 99 || b === 171) {
    if (a < 4096) {
      becomeShipCoord.push({ off: i, a, b });
    }
  }
}
console.log(`Total: ${becomeShipCoord.length}`);
for (const c of becomeShipCoord.slice(0, 30)) {
  console.log(`  ${hex(c.off)}: ${c.a} → ${c.b}`);
}

// Filter: pairs of (X, Y) at the same record
// Look for cases where becomes-171 is followed within 16 bytes by becomes-99 (or vice versa)
console.log('\n=== Paired (becomes-171, becomes-99 within 32B) ===');
for (let i = 0; i < becomeShipCoord.length; i++) {
  for (let j = 0; j < becomeShipCoord.length; j++) {
    if (i === j) continue;
    const c1 = becomeShipCoord[i];
    const c2 = becomeShipCoord[j];
    if (c2.off - c1.off < 0 || c2.off - c1.off > 32) continue;
    if ((c1.b === 171 && c2.b === 99) || (c1.b === 99 && c2.b === 171)) {
      console.log(`  ${hex(c1.off)} ${c1.a}→${c1.b}  +  ${hex(c2.off)} ${c2.a}→${c2.b}  d=${c2.off - c1.off}`);
    }
  }
}

// Also check the ship's record at 0x01591268 — did the ship's UUID also get an extra link?
console.log('\n=== Ship record at 0x01591264 across save_6 vs save_7 ===');
const off = 0x01591264;
const lo = off - 32;
const hi = off + 96;
console.log(`A: ${A.subarray(lo, hi).toString('hex')}`);
console.log(`B: ${B.subarray(lo, hi).toString('hex')}`);
let mark = '';
for (let i = lo; i < hi; i++) mark += (A[i] === B[i]) ? '.' : 'X';
console.log(`D: ${mark}`);
