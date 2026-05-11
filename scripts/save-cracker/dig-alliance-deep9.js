// dig-alliance-deep9.js
// Session 33 found that prev/curr/+8 didn't change for the alliance transition
// (save_2 → save_3). But MAYBE another byte in the cell did change. Let me do a
// CELL-BY-CELL diff for cells [0][156] and [156][0] across all 267 bytes.

const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const A = fs.readFileSync(path.join(SAVE_DIR, "save_2.1.sav"));
const B = fs.readFileSync(path.join(SAVE_DIR, "save_3.1.sav"));

const MAT = 0xf8fd2;
const STRIDE = 267;

function cellOffset(r, c) { return MAT + (r * 239 + c) * STRIDE; }

const cells = [[0, 156], [156, 0], [0, 207], [207, 0]]; // sanity
for (const [r, c] of cells) {
  const off = cellOffset(r, c);
  console.log(`\n=== Cell [${r}][${c}] at 0x${off.toString(16)} ===`);
  const diffs = [];
  for (let k = 0; k < STRIDE; k++) {
    if (A[off + k] !== B[off + k]) diffs.push(k);
  }
  console.log(`  Byte diffs: ${diffs.length} at offsets [${diffs.join(", ")}]`);
  if (diffs.length > 0) {
    for (const d of diffs) {
      console.log(`  +${d}: 0x${A[off + d].toString(16).padStart(2, "0")} → 0x${B[off + d].toString(16).padStart(2, "0")}`);
    }
  }
}

// Also: scan the ENTIRE matrix for cells that changed between save_2 and save_3.
const changedCells = [];
for (let r = 0; r < 239; r++) {
  for (let c = 0; c < 239; c++) {
    const off = cellOffset(r, c);
    let changed = false;
    for (let k = 0; k < STRIDE; k++) {
      if (A[off + k] !== B[off + k]) { changed = true; break; }
    }
    if (changed) {
      // Count diffs
      let nd = 0;
      const diffOffs = [];
      for (let k = 0; k < STRIDE; k++) {
        if (A[off + k] !== B[off + k]) { nd++; diffOffs.push(k); }
      }
      changedCells.push({ r, c, nd, diffOffs });
    }
  }
}
console.log(`\n=== Total changed cells in matrix: ${changedCells.length} ===`);
for (const cc of changedCells.slice(0, 50)) {
  console.log(`  [${cc.r}][${cc.c}]: ${cc.nd} byte diffs at [${cc.diffOffs.join(",")}]`);
}
