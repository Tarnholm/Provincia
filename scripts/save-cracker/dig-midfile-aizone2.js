// dig-midfile-aizone2.js — Map every non-canonical cell against settlement coords and
// check: does each non-canonical cell sit AT or ADJACENT to a settlement? Map distance histogram.
// Also check: f-field tests as path-cost class. Each variant's f28 value tested as terrain class:
//   1=road, 2=plain, 6=hills, 54=sea, 55=mountain etc. — see if cells with f28=X cluster.

const fs = require("fs");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav";
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

// Get settlement coords
function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }
const knownModels = new Set(["W_hellenistic_Large_Town","W_hellenistic_Large_City","Celtic_Large_Town","W_hellenistic_City","Eastern_Large_Town","Illyrian_Large_Town","W_hellenistic_Town","Celtic_City","W_hellenistic_Huge_City","Carthaginian_Huge_City","Carthaginian_Large_Town","Eastern_City","Germanic_Large_Town","Nomad_Large_Town","Eastern_Town","Eastern_Huge_City","Carthaginian_City","Egyptian_Large_Town","Celtic_Town","Carthaginian_Town","Egyptian_Town","Illyrian_Town","Germanic_Town","Nomad_Town"]);
const settCoords = [];
const settSet = new Set();
for (let p = 0x1f43000; p + 2 < 0x1f95000; p++) {
  const lp1 = buf.readUInt16LE(p);
  if (lp1 < 9 || lp1 > 30) continue;
  if (p + 2 + lp1 > 0x1f95000) continue;
  const sl = lp1 - 1;
  let ok = true;
  for (let i = 0; i < sl; i++) if (!isModelChar(buf[p + 2 + i])) { ok = false; break; }
  if (!ok) continue;
  if (buf[p + 2 + sl] !== 0) continue;
  const nm = buf.slice(p + 2, p + 2 + sl).toString("ascii");
  if (!knownModels.has(nm)) continue;
  const postName = p + 2 + lp1;
  const tag = buf.readUInt32LE(postName);
  if (tag !== 27 && tag !== 29 && tag !== 31) { p = postName - 1; continue; }
  const x = buf.readUInt32LE(postName + 4);
  const y = buf.readUInt32LE(postName + 8);
  const k = `${x},${y}`;
  if (!settSet.has(k)) {
    settSet.add(k);
    settCoords.push({ x, y });
  }
  p = postName - 1;
}

// Settlement coords are in tile-coord-space (game's 1500×1500 strategic map).
// Mid-file cells are 240×238 mapping to 1020×700 px on map_regions.tga.
// Question: are settlement coords in the same space as cell→px mapping?
// Settlement Y range was 22..651 — fits 700-height map.
// Settlement X range was 83..988 — fits 1020-width map.
// So settlements ARE in TGA-pixel space directly!

console.log(`Settlement coord ranges: X[${Math.min(...settCoords.map(s=>s.x))}..${Math.max(...settCoords.map(s=>s.x))}], Y[${Math.min(...settCoords.map(s=>s.y))}..${Math.max(...settCoords.map(s=>s.y))}]`);

// Cell-to-pixel: c × 4.25 → x, r × 2.94 → y
const PX_W = 1020, PX_H = 700;
const CELL_PX_W = PX_W / W;
const CELL_PX_H = PX_H / H;

// For each non-canonical cell, find nearest settlement (in TGA px)
function nearestSett(cell) {
  const px = cell.c * CELL_PX_W + CELL_PX_W / 2;
  const py = cell.r * CELL_PX_H + CELL_PX_H / 2;
  let bestD = Infinity, bestS = null;
  for (const s of settCoords) {
    const d = Math.sqrt((px - s.x) ** 2 + (py - s.y) ** 2);
    if (d < bestD) { bestD = d; bestS = s; }
  }
  return { d: bestD, s: bestS, px, py };
}

// Distance histogram for non-canonical cells
const distBins = [0, 2, 5, 10, 20, 50, 100, 200, 500];
const nonCanBins = new Array(distBins.length).fill(0);
for (const c of nonCan) {
  const r = nearestSett(c);
  for (let i = distBins.length - 1; i >= 0; i--) {
    if (r.d >= distBins[i]) { nonCanBins[i]++; break; }
  }
}
console.log(`\n--- Non-canonical cells distance-to-nearest-settlement bins ---`);
for (let i = 0; i < distBins.length; i++) {
  console.log(`  >= ${distBins[i].toString().padStart(3)} px: ${nonCanBins[i]}`);
}

// Test f28 enum hypothesis: do cells with f28=X form contiguous regions on the map?
const f28Histogram = new Map();
for (const c of nonCan) {
  const k = c.f28;
  if (!f28Histogram.has(k)) f28Histogram.set(k, []);
  f28Histogram.get(k).push(c);
}
console.log(`\n--- f28 value histogram (in non-canonical cells) ---`);
for (const [k, cs] of [...f28Histogram.entries()].sort((a, b) => b[1].length - a[1].length)) {
  // 8-neighbour same-f28 fraction
  const set = new Set(cs.map(c => c.idx));
  let matches = 0, total = 0;
  for (const c of cs) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nIdx = (c.r + dr) * W + (c.c + dc);
        if (set.has(nIdx)) matches++;
        total++;
      }
    }
  }
  const frac = total === 0 ? 0 : matches / total;
  console.log(`  f28=${k}: ${cs.length} cells, 8-nbr same=${(frac*100).toFixed(1)}%`);
}

// Test: maybe the non-canonical cells correspond to settlement cells but in a different coordinate system
// What if cell (c, r) corresponds to (c, r) tile in the 240×238 strategic-tile grid (no scale)?
// Settlement X range max ~988, so doesn't fit 240×238.
// But cell grid is 240 wide and Settlement X is 988 max → cells go 0..239, settlements 0..988.
// Could the cell grid be QUARTER-resolution of a 960×~948 grid?
//   240*4=960, 238*4=952 — close to settlement coord range!
// Try: cell (c, r) maps to tile (c*4 + 2, r*4 + 2) — quarter-res with center sampling

console.log(`\n--- ALT: cell maps to tile via 4× upscale (cell c,r → tile c*4+2, r*4+2) ---`);
function nearestSettTile(cell) {
  const tx = cell.c * 4 + 2;
  const ty = cell.r * 4 + 2;
  let bestD = Infinity, bestS = null;
  for (const s of settCoords) {
    const d = Math.abs(tx - s.x) + Math.abs(ty - s.y); // manhattan
    if (d < bestD) { bestD = d; bestS = s; }
  }
  return { d: bestD, s: bestS };
}
// Check the most-common variants
for (const [k, cs] of [...new Map(nonCan.map(c => [`${c.f16}_${c.f20}_${c.f24}_${c.f28}_${c.f32}`, c])).entries()].slice(0, 5)) {
  // ignore
}
for (const [k, cs] of [...f28Histogram.entries()].sort((a,b) => b[1].length - a[1].length).slice(0, 5)) {
  const dists = cs.map(nearestSettTile).map(r => r.d);
  const within5 = dists.filter(d => d <= 5).length;
  const within10 = dists.filter(d => d <= 10).length;
  console.log(`  f28=${k} (n=${cs.length}): nearest tile manhattan dist: within5=${within5}, within10=${within10}, median=${[...dists].sort((a,b)=>a-b)[Math.floor(dists.length/2)]}`);
}

// Visualise: ASCII map of non-canonical cells with settlement coords overlaid
console.log(`\n--- ASCII map (60×30): # = non-canonical cell, S = settlement (best-fit) ---`);
const aw = 60, ah = 30;
const grid = Array.from({ length: ah }, () => Array(aw).fill('.'));
for (const c of nonCan) {
  const ax = Math.floor(c.c * aw / W);
  const ay = Math.floor(c.r * ah / H);
  if (ax >= 0 && ax < aw && ay >= 0 && ay < ah) {
    if (grid[ay][ax] === '.') grid[ay][ax] = '#';
  }
}
for (const s of settCoords) {
  const ax = Math.floor(s.x * aw / 1020);
  const ay = Math.floor(s.y * ah / 700);
  if (ax >= 0 && ax < aw && ay >= 0 && ay < ah) {
    if (grid[ay][ax] === '.' || grid[ay][ax] === '#') grid[ay][ax] = 'S';
  }
}
for (const row of grid) console.log('  ' + row.join(''));
