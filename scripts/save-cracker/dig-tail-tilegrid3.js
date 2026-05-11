// dig-tail-tilegrid3.js — full analysis of the session-14 tail tile grid.
// Use the actual start 0x1f8f97b (rome10) and locate end and content semantics.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function findStart(buf) {
  // Search for first run of >=64 bytes that match pattern (00 ff 00 ff 00 ff ...)
  // starting after offset 0x1f00000.
  for (let p = 0x1f00000; p < buf.length - 128; p++) {
    let isPattern = true;
    for (let j = 0; j < 64; j += 2) {
      if (buf[p + j] !== 0x00 || buf[p + j + 1] !== 0xff) { isPattern = false; break; }
    }
    if (isPattern) return p;
  }
  return -1;
}

function findEnd(buf, start) {
  // From a known mid-grid position, walk forward looking for a transition
  // where >= 128 consecutive bytes BREAK the 00ff every-other-byte pattern.
  // We accept some sparse non-zero bytes at even positions; we look for a region
  // where the odd positions are NOT 0xff.

  // Walk in 64-byte windows. If a window has < 16 bytes equal to 0xff at odd positions
  // (out of 32 odd positions), we've left the grid.
  const W = 256;
  let lastInside = start;
  for (let p = start; p < buf.length - W; p += W) {
    let oddFf = 0;
    for (let j = 1; j < W; j += 2) {
      if (buf[p + j] === 0xff) oddFf++;
    }
    if (oddFf < W / 4) {
      // exited grid
      return lastInside;
    } else {
      lastInside = p + W;
    }
  }
  return lastInside;
}

function analyze(savePath, label) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n===== ${label} =====`);
  const start = findStart(buf);
  const end = findEnd(buf, start);
  console.log(`Grid: 0x${start.toString(16)}..0x${end.toString(16)} = ${end - start} bytes = ${(end - start) / 2} u16 cells`);
  const sz = end - start;
  // common dimensions
  const cells = sz / 2;
  console.log(`sqrt(cells) = ${Math.sqrt(cells).toFixed(2)}`);
  for (const w of [240, 255, 256, 320, 384, 480, 600, 768, 800, 880, 887, 900, 920, 940, 960, 1000, 1024]) {
    if (cells % w === 0) console.log(`  ${w} × ${cells / w} = ${cells}`);
  }

  // Per-cell histogram (assuming u16 LE)
  const u16Hist = new Map();
  for (let p = start; p < end - 1; p += 2) {
    const w = buf.readUInt16LE(p);
    u16Hist.set(w, (u16Hist.get(w) || 0) + 1);
  }
  const u16Sorted = [...u16Hist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Distinct u16 LE: ${u16Sorted.length}`);
  console.log(`Top 20 u16: ${u16Sorted.slice(0, 20).map(([v, c]) => `${v.toString(16).padStart(4, "0")}=${c}`).join(" ")}`);

  // Now the (low_byte) distribution where the cell is NOT 0xff00 (the "background")
  // 0xff00 → low=00, high=ff. Cells with high=ff (background) have low byte=...
  // Actually 0xff00 LE means buf[p]=0x00, buf[p+1]=0xff. So when buf[p+1]==0xff and buf[p]==0x00, that's empty.
  // When buf[p+1]==0xff and buf[p]!=0x00, there's a value with the "filled" high byte.

  // Categorize: high byte (buf[p+1])
  const highHist = new Map();
  for (let p = start; p < end - 1; p += 2) {
    const h = buf[p + 1];
    highHist.set(h, (highHist.get(h) || 0) + 1);
  }
  const highSorted = [...highHist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nHigh-byte (buf[p+1]) histogram top 12: ${highSorted.slice(0, 12).map(([v, c]) => `${v.toString(16).padStart(2,"0")}=${c}`).join(" ")}`);

  // Cells where high byte != 0xff (the "interesting" cells)
  let countNonFf = 0;
  const lowWhenNonFf = new Map();
  const sampleNonFf = [];
  for (let p = start; p < end - 1; p += 2) {
    if (buf[p + 1] !== 0xff) {
      countNonFf++;
      lowWhenNonFf.set(buf[p], (lowWhenNonFf.get(buf[p]) || 0) + 1);
      if (sampleNonFf.length < 16) sampleNonFf.push({ off: p, cell: (p - start) / 2, low: buf[p], high: buf[p + 1] });
    }
  }
  console.log(`Cells with high != 0xff: ${countNonFf} (${(countNonFf / cells * 100).toFixed(2)}%)`);
  const lowSorted = [...lowWhenNonFf.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  Low-byte distribution: ${lowSorted.slice(0, 10).map(([v, c]) => `${v.toString(16).padStart(2,"0")}=${c}`).join(" ")}`);
  console.log(`  First 16 such cells:`);
  for (const c of sampleNonFf) {
    console.log(`    cell ${c.cell} @0x${c.off.toString(16)}: low=0x${c.low.toString(16).padStart(2,"0")} high=0x${c.high.toString(16).padStart(2,"0")}`);
  }

  // Also: cells where low byte != 0 (i.e., non-empty attr)
  let countNonZeroAttr = 0;
  const attrHist = new Map();
  for (let p = start; p < end - 1; p += 2) {
    if (buf[p] !== 0) {
      countNonZeroAttr++;
      attrHist.set(buf[p], (attrHist.get(buf[p]) || 0) + 1);
    }
  }
  console.log(`\nCells with low byte != 0 (non-empty 'attr'): ${countNonZeroAttr} (${(countNonZeroAttr / cells * 100).toFixed(2)}%)`);
  const attrSorted = [...attrHist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  Top 20 attr values: ${attrSorted.slice(0, 20).map(([v, c]) => `${v.toString(16).padStart(2,"0")}=${c}`).join(" ")}`);

  // Spatial distribution: assume W=960 (closest plausible width). For each non-empty cell,
  // compute (col, row) and bin into 6 horizontal stripes for a rough overview.
  // Output a row-by-row count to see if there's vertical structure.
  return { buf, start, end, attrHist, sampleNonFf };
}

const r10 = analyze(ROME10, "rome10");
const rT1 = analyze(ROR_T1, "RoR-T1");

// Cross-save: are the same indices populated, with the same values?
console.log(`\n===== Cross-save cell-by-cell comparison =====`);
const r10cells = (r10.end - r10.start) / 2;
const rT1cells = (rT1.end - rT1.start) / 2;
console.log(`rome10: ${r10cells} cells, RoR-T1: ${rT1cells} cells. min: ${Math.min(r10cells, rT1cells)}`);
let bothNonEmpty = 0;
let onlyR10 = 0;
let onlyT1 = 0;
let differentNonEmpty = 0;
let sameNonEmpty = 0;
let totalCells = Math.min(r10cells, rT1cells);
for (let i = 0; i < totalCells; i++) {
  const w10 = r10.buf.readUInt16LE(r10.start + i * 2);
  const wT1 = rT1.buf.readUInt16LE(rT1.start + i * 2);
  const e10 = (w10 === 0xff00);
  const eT1 = (wT1 === 0xff00);
  if (!e10 && !eT1) {
    bothNonEmpty++;
    if (w10 === wT1) sameNonEmpty++; else differentNonEmpty++;
  } else if (!e10 && eT1) onlyR10++;
  else if (e10 && !eT1) onlyT1++;
}
console.log(`Both non-empty: ${bothNonEmpty} (same value: ${sameNonEmpty}, diff value: ${differentNonEmpty})`);
console.log(`Only rome10 non-empty: ${onlyR10}`);
console.log(`Only RoR-T1 non-empty: ${onlyT1}`);
