// Session 23: test if the 697 truly-interior non-canonical mid-file cells correlate with
// descr_strat-placed entities (settlements). We have settlement (X,Y) from session 16's
// settlement model strings block at 0x1f47abd+.
//
// Approach:
//   1. Read all settlement (X,Y) tile coords (range ~83..988 in X, ~22..651 in Y)
//   2. Map mid-file cells (240×238 grid) to pixel space via the brief's 4.25 × 2.94 px/cell.
//      Cell center = (c * 4.25 + 2.125, r * 2.94 + 1.47) — but this maps to a 1020×700 grid.
//      Settlement X is in 83..988, Y in 22..651 — those are ALSO in the 1020×700 grid space.
//   3. For each non-canonical interior cell, compute its tile (X,Y) and find nearest settlement.
//   4. Histogram: distances <= 3 cells = match.

const fs = require('fs');

const SAVE = 'C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav';
const ARR_START = 0xf8fd2;
const STRIDE = 267;
const W = 240;
const H = 238;
const PX_W = 1020;
const PX_H = 700;
const CELL_PX_W = PX_W / W;  // 4.25
const CELL_PX_H = PX_H / H;  // 2.94

const buf = fs.readFileSync(SAVE);

// Step 1: extract all settlement coords from 0x1f47abd onwards. Per session 16:
//   [u16 strLen+1][ASCII model name][u8 0x00][u32 typeTag][u32 X][u32 Y][...]
// Walk forward.
const settBlockStart = 0x1f47abd - 200;  // start a bit early to catch any leading
const settBlockEnd = 0x1f8f97b;  // session 14 end
const coords = [];
const seenCoord = new Set();

for (let p = settBlockStart; p < settBlockEnd - 32; p++) {
  const strLen = buf.readUInt16LE(p);
  if (strLen < 5 || strLen > 60) continue;
  if (p + 2 + strLen > settBlockEnd) continue;
  // Validate ASCII
  let ok = true;
  for (let i = 0; i < strLen - 1; i++) {
    const b = buf[p + 2 + i];
    if (!(b >= 0x20 && b <= 0x7e)) { ok = false; break; }
  }
  if (!ok) continue;
  // Last char must be NUL
  if (buf[p + 2 + strLen - 1] !== 0) continue;
  const s = buf.subarray(p + 2, p + 2 + strLen - 1).toString('ascii');
  if (!/^[A-Za-z_]+(_City|_Town|_Large_Town|_Huge_City)$/.test(s)) continue;
  // u32 tag at p + 2 + strLen
  const tagOff = p + 2 + strLen;
  const tag = buf.readUInt32LE(tagOff);
  if (![27, 29, 31].includes(tag)) continue;
  const X = buf.readUInt32LE(tagOff + 4);
  const Y = buf.readUInt32LE(tagOff + 8);
  if (X < 1 || X > 1500 || Y < 1 || Y > 1500) continue;
  const key = `${X},${Y}`;
  if (seenCoord.has(key)) continue;
  seenCoord.add(key);
  coords.push({ off: p, name: s, tag, X, Y });
}

console.log(`Settlement coords extracted: ${coords.length} unique (X,Y) tiles`);
console.log(`X range: ${Math.min(...coords.map(c => c.X))}..${Math.max(...coords.map(c => c.X))}`);
console.log(`Y range: ${Math.min(...coords.map(c => c.Y))}..${Math.max(...coords.map(c => c.Y))}`);

// Step 2: extract non-canonical mid-file cells (excluding anti-diagonal and right/bottom edges)
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

// Filter: non-canonical = NOT (200_200_2_6_200) AND interior (not edge, not anti-diagonal)
const isCanonical = c => (c.f16 === 200 && c.f20 === 200 && c.f24 === 2 && c.f28 === 6 && c.f32 === 200);
const isInterior = c => (c.c !== 239 && c.r !== 237 && (c.c + c.r) !== 237);
const nonCanInterior = cells.filter(c => !isCanonical(c) && isInterior(c));
console.log(`\nNon-canonical interior cells: ${nonCanInterior.length}`);

// Step 3: for each non-canonical cell, compute pixel-center and find nearest settlement
function cellToPx(c, r) {
  return { x: c * CELL_PX_W + CELL_PX_W / 2, y: r * CELL_PX_H + CELL_PX_H / 2 };
}

let withinR1 = 0, withinR2 = 0, withinR3 = 0, withinR5 = 0, withinR10 = 0;
const distances = [];

for (const cell of nonCanInterior) {
  const px = cellToPx(cell.c, cell.r);
  let minDist = Infinity, minSett = null;
  for (const s of coords) {
    const dx = s.X - px.x;
    const dy = s.Y - px.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < minDist) { minDist = d; minSett = s; }
  }
  distances.push({ cell, px, minDist, minSett });
  // Convert to cell-units (use min of W/H scale)
  const cellDist = minDist / Math.min(CELL_PX_W, CELL_PX_H);
  if (cellDist < 1) withinR1++;
  if (cellDist < 2) withinR2++;
  if (cellDist < 3) withinR3++;
  if (cellDist < 5) withinR5++;
  if (cellDist < 10) withinR10++;
}

console.log(`\n=== Distance histogram (in cells) of non-canon cell → nearest settlement ===`);
console.log(`Within 1 cell:  ${withinR1} (${(withinR1/nonCanInterior.length*100).toFixed(1)}%)`);
console.log(`Within 2 cells: ${withinR2} (${(withinR2/nonCanInterior.length*100).toFixed(1)}%)`);
console.log(`Within 3 cells: ${withinR3} (${(withinR3/nonCanInterior.length*100).toFixed(1)}%)`);
console.log(`Within 5 cells: ${withinR5} (${(withinR5/nonCanInterior.length*100).toFixed(1)}%)`);
console.log(`Within 10 cells: ${withinR10} (${(withinR10/nonCanInterior.length*100).toFixed(1)}%)`);

// Compare with random baseline: pick 697 random interior cells, compute same metric
const rng = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
const interiorCanonical = cells.filter(c => isCanonical(c) && isInterior(c));
console.log(`\n=== Random baseline (697 canonical interior cells) ===`);
const sample = [];
for (let i = 0; i < nonCanInterior.length; i++) {
  sample.push(interiorCanonical[Math.floor(rng() * interiorCanonical.length)]);
}
let r1b = 0, r2b = 0, r3b = 0, r5b = 0, r10b = 0;
for (const cell of sample) {
  const px = cellToPx(cell.c, cell.r);
  let minDist = Infinity;
  for (const s of coords) {
    const dx = s.X - px.x, dy = s.Y - px.y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < minDist) minDist = d;
  }
  const cellDist = minDist / Math.min(CELL_PX_W, CELL_PX_H);
  if (cellDist < 1) r1b++;
  if (cellDist < 2) r2b++;
  if (cellDist < 3) r3b++;
  if (cellDist < 5) r5b++;
  if (cellDist < 10) r10b++;
}
console.log(`Within 1 cell:  ${r1b} (${(r1b/sample.length*100).toFixed(1)}%)`);
console.log(`Within 2 cells: ${r2b} (${(r2b/sample.length*100).toFixed(1)}%)`);
console.log(`Within 3 cells: ${r3b} (${(r3b/sample.length*100).toFixed(1)}%)`);
console.log(`Within 5 cells: ${r5b} (${(r5b/sample.length*100).toFixed(1)}%)`);
console.log(`Within 10 cells: ${r10b} (${(r10b/sample.length*100).toFixed(1)}%)`);

// Show the cells with closest matches (within 1 cell): are they really at settlements?
console.log(`\n=== Sample 20 non-canonical cells with nearest settlement ===`);
distances.sort((a, b) => a.minDist - b.minDist).slice(0, 20).forEach(d => {
  const cd = d.minDist / Math.min(CELL_PX_W, CELL_PX_H);
  console.log(`  cell (${d.cell.c},${d.cell.r}) px=(${d.px.x.toFixed(0)},${d.px.y.toFixed(0)})  -> settlement '${d.minSett.name}' @ (${d.minSett.X},${d.minSett.Y})  dist=${d.minDist.toFixed(1)}px = ${cd.toFixed(2)} cells`);
});
