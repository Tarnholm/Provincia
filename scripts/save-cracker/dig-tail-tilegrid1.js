// dig-tail-tilegrid1.js — characterize the ~1.83MB tail tile grid at
// 0x1f8f97b..0x210f4d4 (rome10). Session 14 noted 00-ff stride pattern with
// sparse non-zero cells. Goal: (1) confirm boundaries on both rome10 + RoR-T1,
// (2) byte-value histogram, (3) check if it's 2-byte-stride (u8 attr + 0xff pad)
// or 1-byte-stride sparse, (4) verify size is consistent with 960x960 or some
// other dimension that matches RR's expected campaign map resolution.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function analyze(savePath, label) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n===== ${label} (size ${buf.length}) =====`);

  // Session 14 boundaries (rome10): 0x1f8f97b..0x210f4d4 → 1,571,673 bytes ≈ 1.5MB
  // Session 14 reported ~1.83MB — actually 0x210f4d4 - 0x1f8f97b = 0x17fb59 = 1,571,673.
  // That's ~786K 2-byte cells, ~887x887 grid. Let's verify.

  // First: scan for the "00 ff 00 ff" pattern boundaries.
  // Look for transition from end-of-W_models to start of 00ff pattern.
  // Then find the end where the pattern stops.

  // Walk in 4KB blocks counting 0x00ff u16 LE words.
  const BLOCK = 0x1000;
  const blocks = [];
  for (let off = 0x1f00000; off < buf.length; off += BLOCK) {
    const end = Math.min(off + BLOCK, buf.length - 1);
    let n00ff = 0;
    let nZero = 0;
    let nOther = 0;
    let nFf = 0;
    for (let p = off; p < end; p += 2) {
      const w = buf.readUInt16LE(p);
      if (w === 0xff00) n00ff++;
      else if (w === 0x0000) nZero++;
      else if (w === 0xffff) nFf++;
      else nOther++;
    }
    blocks.push({ off, n00ff, nZero, nOther, nFf });
  }

  // Determine start of "tile grid" zone: first block where n00ff dominates (>400 of 2048)
  let gridStart = -1, gridEnd = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.n00ff > 400 && gridStart === -1) gridStart = b.off;
    if (gridStart !== -1 && b.n00ff < 100) {
      gridEnd = b.off;
      break;
    }
  }
  console.log(`Detected 00ff-dominated zone: 0x${gridStart.toString(16)}..0x${gridEnd.toString(16)} = ${gridEnd - gridStart} bytes`);

  // Refine boundaries: walk forward from gridStart looking for first 2-byte cell that's NOT (anything, 0xff).
  // And walk backward from gridEnd looking for last cell.
  let realStart = gridStart;
  // Move back: scan 256 bytes prior for the LAST byte that's not (00 ff pattern)
  for (let p = gridStart - 512; p < gridStart + 16; p++) {
    if (buf[p] === 0x00 && buf[p+1] === 0xff && buf[p+2] === 0x00 && buf[p+3] === 0xff && buf[p+4] === 0x00 && buf[p+5] === 0xff) {
      realStart = p;
      break;
    }
  }
  let realEnd = gridEnd;
  // Move forward looking for last cell ending in 0xff.
  for (let p = gridEnd + 0x1000; p > gridEnd - 16; p -= 2) {
    if (buf[p-2] === 0xff && (buf[p-3] === 0x00 || buf[p-3] === 0x01 || buf[p-3] === 0x02)) {
      // Look backward through pattern
      let last = p;
      for (let q = p - 2; q > gridEnd - 0x1000; q -= 2) {
        if (buf[q+1] === 0xff) last = q + 2;
        else break;
      }
      realEnd = last;
      break;
    }
  }
  console.log(`Refined zone: 0x${realStart.toString(16)}..0x${realEnd.toString(16)} = ${realEnd - realStart} bytes`);

  // Byte histogram over the zone
  const hist = new Array(256).fill(0);
  for (let p = realStart; p < realEnd; p++) hist[buf[p]]++;
  const sorted = hist.map((c, v) => ({ v, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
  console.log(`Byte histogram top 12: ${sorted.slice(0, 12).map(x => `0x${x.v.toString(16).padStart(2,"0")}=${x.c}`).join(", ")}`);
  console.log(`Total distinct byte values: ${sorted.length}`);

  // Even-position byte histogram (the "attr" byte if stride=2)
  const evenHist = new Array(256).fill(0);
  const oddHist = new Array(256).fill(0);
  for (let p = realStart; p < realEnd - 1; p += 2) {
    evenHist[buf[p]]++;
    oddHist[buf[p+1]]++;
  }
  const evenSorted = evenHist.map((c, v) => ({ v, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
  const oddSorted = oddHist.map((c, v) => ({ v, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c);
  console.log(`Even-position bytes top 12: ${evenSorted.slice(0, 12).map(x => `0x${x.v.toString(16).padStart(2,"0")}=${x.c}`).join(", ")}`);
  console.log(`Odd-position bytes top 12: ${oddSorted.slice(0, 12).map(x => `0x${x.v.toString(16).padStart(2,"0")}=${x.c}`).join(", ")}`);
  console.log(`Distinct even-byte values: ${evenSorted.length}, distinct odd-byte values: ${oddSorted.length}`);

  // u16 LE distribution
  const u16Hist = new Map();
  for (let p = realStart; p < realEnd - 1; p += 2) {
    const w = buf.readUInt16LE(p);
    u16Hist.set(w, (u16Hist.get(w) || 0) + 1);
  }
  const u16Sorted = [...u16Hist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Distinct u16 LE values: ${u16Sorted.length}`);
  console.log(`Top 15 u16 LE: ${u16Sorted.slice(0, 15).map(([v, c]) => `0x${v.toString(16).padStart(4,"0")}=${c}`).join(", ")}`);

  // Compute possible grid dimensions
  const cells2 = (realEnd - realStart) / 2;
  const cells4 = (realEnd - realStart) / 4;
  console.log(`\nIf stride=2: ${cells2} cells. sqrt=${Math.sqrt(cells2).toFixed(2)}.`);
  for (const w of [240, 255, 256, 300, 320, 600, 768, 800, 880, 887, 960, 1000, 1024]) {
    if (cells2 % w === 0) console.log(`  ${w} × ${cells2 / w} = ${cells2}`);
  }
  console.log(`If stride=4: ${cells4} cells. sqrt=${Math.sqrt(cells4).toFixed(2)}.`);
  for (const w of [240, 255, 256, 320, 384, 480, 600, 768, 1024]) {
    if (cells4 % w === 0) console.log(`  ${w} × ${cells4 / w} = ${cells4}`);
  }

  // Look at non-zero cells (where attr != 0)
  let nonZero2 = 0;
  const sample2 = [];
  for (let p = realStart; p < realEnd - 1; p += 2) {
    if (buf[p] !== 0) {
      nonZero2++;
      if (sample2.length < 20) sample2.push({ off: p, idx: (p - realStart) / 2, attr: buf[p], pad: buf[p+1] });
    }
  }
  console.log(`\nIf stride=2: non-zero attr cells: ${nonZero2} (${(nonZero2 / cells2 * 100).toFixed(2)}%)`);
  console.log(`First 20 non-zero cells (stride=2):`);
  for (const c of sample2) console.log(`  idx ${c.idx} @0x${c.off.toString(16)}: attr=0x${c.attr.toString(16)} pad=0x${c.pad.toString(16)}`);

  // Distinct attr values where attr != 0 (stride=2)
  const attrSet = new Map();
  for (let p = realStart; p < realEnd - 1; p += 2) {
    if (buf[p] !== 0) attrSet.set(buf[p], (attrSet.get(buf[p]) || 0) + 1);
  }
  console.log(`\nStride=2 distinct non-zero attr values: ${attrSet.size}`);
  const attrSorted = [...attrSet.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Top 20: ${attrSorted.slice(0, 20).map(([a, c]) => `0x${a.toString(16).padStart(2,"0")}=${c}`).join(", ")}`);

  return { realStart, realEnd, attrSet, sample2 };
}

const r10 = analyze(ROME10, "rome10");
const rT1 = analyze(ROR_T1, "RoR-T1");

// Cross-save byte diff
const buf10 = fs.readFileSync(ROME10);
const bufT1 = fs.readFileSync(ROR_T1);
console.log(`\n===== Cross-save byte diff =====`);
console.log(`rome10 zone: 0x${r10.realStart.toString(16)}..0x${r10.realEnd.toString(16)} = ${r10.realEnd - r10.realStart}`);
console.log(`RoR-T1 zone: 0x${rT1.realStart.toString(16)}..0x${rT1.realEnd.toString(16)} = ${rT1.realEnd - rT1.realStart}`);
const len = Math.min(r10.realEnd - r10.realStart, rT1.realEnd - rT1.realStart);
let diffs = 0;
const diffOffsets = [];
for (let i = 0; i < len; i++) {
  if (buf10[r10.realStart + i] !== bufT1[rT1.realStart + i]) {
    diffs++;
    if (diffOffsets.length < 30) diffOffsets.push(i);
  }
}
console.log(`Diff count: ${diffs} / ${len} (${(diffs / len * 100).toFixed(3)}%)`);
console.log(`First 30 diff byte offsets (within zone): ${diffOffsets.slice(0, 30).join(", ")}`);
if (diffOffsets.length > 0) {
  console.log(`\nSample diff context:`);
  for (const d of diffOffsets.slice(0, 5)) {
    console.log(`  offset+${d}: rome10=0x${buf10[r10.realStart + d].toString(16)} vs RoR-T1=0x${bufT1[rT1.realStart + d].toString(16)}`);
  }
}
