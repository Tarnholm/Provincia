// dig-midfile-aizone5.js — Test: do non-canonical cells sit ON or NEAR region borders?
// Method: for each cell, sample 4-8 surrounding TGA pixels. Count distinct region colors.
// Border cells have > 1 distinct region color in neighborhood. Interior cells have 1.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
const REGIONS_TGA = "C:/RIS/RIS/data/world/maps/base/map_regions.tga";

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
      f16: buf.readUInt32LE(off + 16),
      f20: buf.readUInt32LE(off + 20),
      f24: buf.readUInt32LE(off + 24),
      f28: buf.readUInt32LE(off + 28),
      f32: buf.readUInt32LE(off + 32),
    });
  }
}
const isCanonical = c => (c.f16 === 200 && c.f20 === 200 && c.f24 === 2 && c.f28 === 6 && c.f32 === 200);
const isInterior = c => (c.c !== 239 && c.r !== 237 && (c.c + c.r) !== 237);
const interior = cells.filter(isInterior);
const nonCan = interior.filter(c => !isCanonical(c));
const canon = interior.filter(isCanonical);

const tga = fs.readFileSync(REGIONS_TGA);
const tgaW = tga.readUInt16LE(12);
const tgaH = tga.readUInt16LE(14);
const headerSize = 18;
function getPx(x, y) {
  if (x < 0 || x >= tgaW || y < 0 || y >= tgaH) return null;
  const tgaRow = tgaH - 1 - y;
  const off = headerSize + (tgaRow * tgaW + x) * 3;
  return `${tga[off+2]},${tga[off+1]},${tga[off]}`;
}

const PX_W = 1020, PX_H = 700;
const CELL_PX_W = PX_W / W;
const CELL_PX_H = PX_H / H;

// For each cell, count distinct region colors in its footprint (5×5 sampling pattern)
function distinctRegionsInCell(cell) {
  const x0 = cell.c * CELL_PX_W;
  const y0 = cell.r * CELL_PX_H;
  const colors = new Set();
  for (let dy = 0; dy < 5; dy++) {
    for (let dx = 0; dx < 5; dx++) {
      const x = Math.round(x0 + dx * CELL_PX_W / 4);
      const y = Math.round(y0 + dy * CELL_PX_H / 4);
      const c = getPx(x, y);
      if (c) colors.add(c);
    }
  }
  return colors.size;
}

// Histogram of distinct-region-count for non-can vs sample of canonical
const ncHist = new Array(10).fill(0);
for (const c of nonCan) {
  const n = Math.min(distinctRegionsInCell(c), 9);
  ncHist[n]++;
}

// Sample canonical (since 55k is too slow)
const sample = [];
for (let i = 0; i < canon.length; i += Math.floor(canon.length / 1000)) sample.push(canon[i]);
const canHist = new Array(10).fill(0);
for (const c of sample) {
  const n = Math.min(distinctRegionsInCell(c), 9);
  canHist[n]++;
}

console.log("Distinct-region-count histogram (in cell's 5x5 sample area):");
console.log("count | non-canon | canon-sample");
for (let i = 0; i < 10; i++) {
  console.log(`  ${i}  | ${ncHist[i].toString().padStart(8)} | ${canHist[i].toString().padStart(10)}`);
}
console.log(`\nTotal non-can: ${nonCan.length}, canon sample: ${sample.length}`);
const ncMulti = ncHist.slice(2).reduce((s,v)=>s+v,0);
const canMulti = canHist.slice(2).reduce((s,v)=>s+v,0);
console.log(`Non-canonical multi-region (border) cells: ${ncMulti} / ${nonCan.length} = ${(ncMulti*100/nonCan.length).toFixed(1)}%`);
console.log(`Canonical (sample) multi-region cells: ${canMulti} / ${sample.length} = ${(canMulti*100/sample.length).toFixed(1)}%`);

// More specific: how many non-can cells have >= 3 regions?
const nc3plus = ncHist.slice(3).reduce((s,v)=>s+v,0);
const can3plus = canHist.slice(3).reduce((s,v)=>s+v,0);
console.log(`Non-canonical with >=3 regions in 5x5: ${nc3plus}/${nonCan.length} = ${(nc3plus*100/nonCan.length).toFixed(1)}%`);
console.log(`Canonical (sample) with >=3 regions: ${can3plus}/${sample.length} = ${(can3plus*100/sample.length).toFixed(1)}%`);

// Per session 22 + sea region: sea pixels are RGB(41,140,X) — count cells where >50% of 5x5 are sea
function fracSea(cell) {
  const x0 = cell.c * CELL_PX_W;
  const y0 = cell.r * CELL_PX_H;
  let nSea = 0, n = 0;
  for (let dy = 0; dy < 5; dy++) {
    for (let dx = 0; dx < 5; dx++) {
      const x = Math.round(x0 + dx * CELL_PX_W / 4);
      const y = Math.round(y0 + dy * CELL_PX_H / 4);
      if (x < 0 || x >= tgaW || y < 0 || y >= tgaH) continue;
      const off = headerSize + ((tgaH - 1 - y) * tgaW + x) * 3;
      const r = tga[off + 2], g = tga[off + 1], b = tga[off];
      n++;
      if (r === 41 && g === 140 && b > 220) nSea++;
    }
  }
  return n === 0 ? 0 : nSea / n;
}

// Coast cells = mixed land/sea
const ncCoast = nonCan.filter(c => { const f = fracSea(c); return f > 0 && f < 1; });
const sampleCoast = sample.filter(c => { const f = fracSea(c); return f > 0 && f < 1; });
console.log(`\nNon-canonical cells partially-sea (coastal): ${ncCoast.length}/${nonCan.length} = ${(ncCoast.length*100/nonCan.length).toFixed(1)}%`);
console.log(`Canonical (sample) partially-sea: ${sampleCoast.length}/${sample.length} = ${(sampleCoast.length*100/sample.length).toFixed(1)}%`);

// Cross-validate session 23's coast hypothesis: f28=54 cells should be more sea than f28=6 cells
// f28=54 was 9.6% sea per session 22 vs 7.4% canonical
const f28cells = new Map();
for (const c of nonCan) {
  const k = c.f28;
  if (!f28cells.has(k)) f28cells.set(k, []);
  f28cells.get(k).push(c);
}
console.log(`\n--- f28 frac-sea breakdown ---`);
for (const [k, cs] of [...f28cells.entries()].sort((a,b) => b[1].length - a[1].length)) {
  const ms = cs.map(fracSea);
  const mean = ms.reduce((s,v)=>s+v,0) / ms.length;
  const allSea = ms.filter(v => v >= 0.5).length;
  const allLand = ms.filter(v => v === 0).length;
  const coast = ms.filter(v => v > 0 && v < 0.5).length;
  console.log(`  f28=${k} (n=${cs.length}): mean-frac-sea=${(mean*100).toFixed(1)}%, allSea=${allSea}, allLand=${allLand}, coast=${coast}`);
}

// Now check: is there a CROSS-SAVE difference in non-canonical-cell locations?
// Load RoR-T1 and find ARR_START analog. Session 18-23 used same arr position; check if it works.
const SAVE_T1 = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 1.sav";
const bufT1 = fs.readFileSync(SAVE_T1);

// Find ARR_START in T1. The mid-file array signature is the canonical pattern at the start.
// Session 18 likely documented this. Try ARR_START as-is first (might be at same absolute offset).
function parseCells(bufA, arrStart) {
  const cells = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const idx = r * W + c;
      const off = arrStart + idx * STRIDE;
      if (off + 36 > bufA.length) return null;
      cells.push({
        idx, c, r,
        f16: bufA.readUInt32LE(off + 16),
        f20: bufA.readUInt32LE(off + 20),
        f24: bufA.readUInt32LE(off + 24),
        f28: bufA.readUInt32LE(off + 28),
        f32: bufA.readUInt32LE(off + 32),
      });
    }
  }
  return cells;
}

// T1 ARR_START may be different. Probe a few likely positions
const tryT1Starts = [ARR_START, 0xf8fd2 - 1000, 0xf8fd2 + 1000, 0xf3fd2, 0xf0000];
for (const s of tryT1Starts) {
  const t = parseCells(bufT1, s);
  if (!t) continue;
  const cn = t.filter(isCanonical).length;
  console.log(`T1 try ARR=0x${s.toString(16)}: canonical=${cn} (target ~55709)`);
}

// Also scan for the pattern: 240*238 cells of fixed stride with the canonical signature
function findArr(bufA) {
  // Scan for 200,200,2,6,200 pattern as a u32-quintuple at any offset
  // Then verify it repeats at STRIDE
  for (let p = 0xe0000; p + 36 + STRIDE * 5 < 0x1000000; p++) {
    if (bufA.readUInt32LE(p + 16) !== 200) continue;
    if (bufA.readUInt32LE(p + 20) !== 200) continue;
    if (bufA.readUInt32LE(p + 24) !== 2) continue;
    if (bufA.readUInt32LE(p + 28) !== 6) continue;
    if (bufA.readUInt32LE(p + 32) !== 200) continue;
    // Check 5 strides forward have same canonical or related
    let matchOk = true;
    for (let i = 1; i <= 5; i++) {
      if (bufA.readUInt32LE(p + i * STRIDE + 16) !== 200) { matchOk = false; break; }
    }
    if (matchOk) return p;
  }
  return null;
}
const t1Arr = findArr(bufT1);
console.log(`\nT1 mid-file array found at: 0x${t1Arr ? t1Arr.toString(16) : "?"}`);

if (t1Arr) {
  const t1Cells = parseCells(bufT1, t1Arr);
  const t1Interior = t1Cells.filter(isInterior);
  const t1NonCan = t1Interior.filter(c => !isCanonical(c));
  console.log(`T1 non-canonical interior: ${t1NonCan.length}`);
  // Check: how many of rome10's non-canon cells are also non-canon in T1?
  const ncIdxSet = new Set(nonCan.map(c => c.idx));
  const t1NcIdxSet = new Set(t1NonCan.map(c => c.idx));
  const intersection = [...ncIdxSet].filter(i => t1NcIdxSet.has(i)).length;
  const union = new Set([...ncIdxSet, ...t1NcIdxSet]);
  console.log(`Shared non-canonical cell positions T1 ∩ T5 (rome10): ${intersection}`);
  console.log(`Union: ${union.size}, IoU = ${(intersection / union.size * 100).toFixed(1)}%`);

  // For shared cells, do the f-values match?
  let matchAll = 0, matchNone = 0;
  for (const idx of ncIdxSet) {
    if (!t1NcIdxSet.has(idx)) continue;
    const a = nonCan.find(c => c.idx === idx);
    const b = t1NonCan.find(c => c.idx === idx);
    if (a.f16 === b.f16 && a.f20 === b.f20 && a.f24 === b.f24 && a.f28 === b.f28 && a.f32 === b.f32) matchAll++;
    else matchNone++;
  }
  console.log(`Shared cells with IDENTICAL f-values: ${matchAll}, different: ${matchNone}`);
}
