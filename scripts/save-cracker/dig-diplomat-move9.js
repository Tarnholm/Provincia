// Find the diplomat character record. Save_4.2 vs save_1.2 differs by 89B
// net, and one key location is at ~0x1f48540 (W_hellenistic_Large_Town insert).
// The diplomat's character record itself should be in the "character records"
// section (per session 7-9 finding ~0x4000..0x20000) or in a later section.
//
// Important fact: the diplomat MOVED, so his (X,Y) coordinates updated.
// Let me search for changed u32 pairs that look like coordinates.
//
// Actually, the +32 byte insert at 0x1504eb9 contained 4 (1, value) pairs:
//   (1, 229) (1, 3759) (1, 193) (1, 3833)
// Likely the diplomat just scouted 4 tile-IDs.
//
// Let me check what changed in the diplomat's actual record by looking at
// session 8 (trade routes + character tail bytes).

const fs = require('fs');
const path = require('path');

const SAVE_DIR = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves';
const A = fs.readFileSync(path.join(SAVE_DIR, 'save_1.2.sav'));
const B = fs.readFileSync(path.join(SAVE_DIR, 'save_4.2.sav'));

// Per session 35, the tile grid at 0x633c50..0xf84632 has 240×153 = 36720 cells
// with 267-byte stride. The diplomat moved 2 tiles south. If fog-of-war reveals
// 2 new tile records in the grid, they'd be 2 × 267 = 534 bytes... but in our
// case the structural delta is 89 B not 534 B.
//
// HYPOTHESIS: fog-of-war reveal does NOT touch the 240×153 tile grid.
// The fog-of-war state lives in the SETTLEMENT-DISCOVERY list at 0x1f48000+.

// Check if any of session 35's 6 variable fields (+20, +28, +32) at the
// 240×153 grid changed between save_3.2 (or save_1.2) and save_4.2.

function compareGrid(a, b) {
  const gridStart = 0x633c50;
  const stride = 267;
  const count = 36583;  // per session 35
  let changedRecs = 0;
  let totalChangedBytes = 0;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const off = gridStart + i * stride;
    if (off + stride > a.length || off + stride > b.length) break;
    let diffBytes = 0;
    for (let k = 0; k < stride; k++) if (a[off+k] !== b[off+k]) diffBytes++;
    if (diffBytes > 0) {
      changedRecs++;
      totalChangedBytes += diffBytes;
      if (samples.length < 20) {
        samples.push({ i, off, diffBytes, aHex: a.slice(off, off+40).toString('hex'), bHex: b.slice(off, off+40).toString('hex') });
      }
    }
  }
  return { changedRecs, totalChangedBytes, samples };
}

const cmp = compareGrid(A, B);
console.log(`Tile-grid (save_1.2 vs save_4.2) — changed records: ${cmp.changedRecs}; changed bytes: ${cmp.totalChangedBytes}`);
for (const s of cmp.samples) {
  console.log(`  rec[${s.i}] off=0x${s.off.toString(16)} diff=${s.diffBytes}B`);
  console.log(`    A: ${s.aHex}`);
  console.log(`    B: ${s.bHex}`);
}
