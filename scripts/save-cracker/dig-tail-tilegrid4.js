// dig-tail-tilegrid4.js — Use a STRICTER startfinder. We need the LARGEST
// run of 00ff pattern, not the first small one. Find all candidate 00ff runs
// of length > 4KB and report.

const fs = require("fs");

const ROME10 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const ROR_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";

function findAllRuns(buf) {
  // Find all contiguous runs where >=70% of 256-byte windows have >=80 cells of 0xff00.
  const W = 256;  // 128 cells
  const runs = [];
  let inRun = false;
  let runStart = -1;
  for (let p = 0x1f00000; p < buf.length - W; p += W) {
    let nFf00 = 0;
    for (let j = 0; j < W; j += 2) {
      const w = buf.readUInt16LE(p + j);
      if (w === 0xff00) nFf00++;
    }
    const isPattern = nFf00 >= 60; // >= 47% pattern
    if (isPattern && !inRun) { inRun = true; runStart = p; }
    else if (!isPattern && inRun) {
      inRun = false;
      runs.push({ start: runStart, end: p, sz: p - runStart });
    }
  }
  if (inRun) runs.push({ start: runStart, end: buf.length, sz: buf.length - runStart });
  return runs;
}

function fineRefineEnd(buf, startApprox, endApprox) {
  // walk forward 2 bytes at a time, looking for the LAST cell where buf[p+1] is 0xff.
  // Once we've gone N cells without finding ff, stop.
  let lastFf = startApprox;
  let missStreak = 0;
  for (let p = startApprox; p < endApprox + 0x10000; p += 2) {
    if (buf[p + 1] === 0xff) { lastFf = p + 2; missStreak = 0; }
    else { missStreak++; if (missStreak > 512) break; }
  }
  return lastFf;
}
function fineRefineStart(buf, startApprox) {
  // walk backward
  let firstFf = startApprox;
  let missStreak = 0;
  for (let p = startApprox; p > startApprox - 0x10000; p -= 2) {
    if (buf[p + 1] === 0xff && buf[p] === 0x00) { firstFf = p; missStreak = 0; }
    else { missStreak++; if (missStreak > 512) break; }
  }
  return firstFf;
}

function analyze(savePath, label) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n===== ${label} =====`);
  const runs = findAllRuns(buf);
  console.log(`Found ${runs.length} 00ff-dominated runs >= 4KB:`);
  runs.forEach((r, i) => {
    console.log(`  [${i}] 0x${r.start.toString(16)}..0x${r.end.toString(16)} = ${r.sz} bytes`);
  });
  // Largest
  const big = runs.reduce((a, b) => (a.sz > b.sz ? a : b));
  console.log(`Largest: 0x${big.start.toString(16)}..0x${big.end.toString(16)} (${big.sz} bytes)`);

  // Refine boundaries
  const fStart = fineRefineStart(buf, big.start + 128);
  const fEnd = fineRefineEnd(buf, big.start + 128, big.end);
  console.log(`Refined: 0x${fStart.toString(16)}..0x${fEnd.toString(16)} = ${fEnd - fStart} bytes = ${(fEnd - fStart) / 2} u16 cells`);

  return { buf, start: fStart, end: fEnd };
}

const r10 = analyze(ROME10, "rome10");
const rT1 = analyze(ROR_T1, "RoR-T1");

// Now do detailed analysis on big grid.
function detail(buf, start, end, label) {
  console.log(`\n----- ${label} detail (${end - start} bytes, ${(end - start) / 2} cells) -----`);

  // Test possible widths
  const cells = (end - start) / 2;
  console.log(`sqrt(cells) = ${Math.sqrt(cells).toFixed(2)}`);
  for (const w of [240, 255, 256, 320, 384, 480, 512, 600, 768, 800, 880, 887, 900, 920, 940, 960, 1000, 1024, 1080]) {
    if (cells % w === 0) console.log(`  divisor ${w}: rows=${cells / w}`);
    else if (cells / w > 10 && cells / w < 2000) {
      const rows = Math.floor(cells / w);
      const remainder = cells - rows * w;
      if (remainder < 50) console.log(`  near-divisor ${w}: rows=${rows} + ${remainder} extra cells`);
    }
  }

  // u16 histogram (collapse 0xff00 bucket)
  const u16Hist = new Map();
  let totalCells = 0;
  let bgCells = 0;
  for (let p = start; p < end - 1; p += 2) {
    const w = buf.readUInt16LE(p);
    if (w === 0xff00) bgCells++;
    else u16Hist.set(w, (u16Hist.get(w) || 0) + 1);
    totalCells++;
  }
  console.log(`Total cells: ${totalCells}, background (0xff00): ${bgCells} (${(bgCells / totalCells * 100).toFixed(2)}%)`);
  const u16Sorted = [...u16Hist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Distinct non-bg u16 values: ${u16Sorted.length}`);
  console.log(`Top 25 non-bg: ${u16Sorted.slice(0, 25).map(([v, c]) => `${v.toString(16).padStart(4, "0")}=${c}`).join(" ")}`);

  // Per-byte (assume "low" byte is "attr", "high" byte is some flag) statistics for non-bg cells
  const lowHist = new Map();
  const highHist = new Map();
  for (let p = start; p < end - 1; p += 2) {
    const w = buf.readUInt16LE(p);
    if (w === 0xff00) continue;
    lowHist.set(buf[p], (lowHist.get(buf[p]) || 0) + 1);
    highHist.set(buf[p + 1], (highHist.get(buf[p + 1]) || 0) + 1);
  }
  console.log(`Non-bg low-byte: ${[...lowHist.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20).map(([v, c]) => `${v.toString(16).padStart(2,"0")}=${c}`).join(" ")}`);
  console.log(`Non-bg high-byte: ${[...highHist.entries()].sort((a,b) => b[1] - a[1]).slice(0, 20).map(([v, c]) => `${v.toString(16).padStart(2,"0")}=${c}`).join(" ")}`);

  return { totalCells, bgCells };
}

detail(r10.buf, r10.start, r10.end, "rome10");
detail(rT1.buf, rT1.start, rT1.end, "RoR-T1");

// Cross-save cell comparison
console.log(`\n===== Cross-save cell comparison =====`);
const r10cells = (r10.end - r10.start) / 2;
const rT1cells = (rT1.end - rT1.start) / 2;
console.log(`rome10: ${r10cells} cells, RoR-T1: ${rT1cells} cells. Equal? ${r10cells === rT1cells}`);
const n = Math.min(r10cells, rT1cells);
let same = 0, diff = 0, diffSamples = [];
for (let i = 0; i < n; i++) {
  const w10 = r10.buf.readUInt16LE(r10.start + i * 2);
  const wT1 = rT1.buf.readUInt16LE(rT1.start + i * 2);
  if (w10 === wT1) same++; else { diff++; if (diffSamples.length < 15) diffSamples.push({i, w10, wT1}); }
}
console.log(`Same cell values: ${same}/${n} (${(same / n * 100).toFixed(3)}%)`);
console.log(`Different: ${diff}`);
console.log(`First 15 diffs:`);
for (const s of diffSamples) console.log(`  cell ${s.i}: rome10=0x${s.w10.toString(16).padStart(4,"0")} RoR-T1=0x${s.wT1.toString(16).padStart(4,"0")}`);
