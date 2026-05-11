// dig-midfile-aizone3.js — Non-canonical cells cluster in northern half.
// Test: do non-canonical cells correspond to specific REGION COLORS in map_regions.tga?
// Each region in RTW has a unique color in map_regions.tga. If non-canonical cells map 1:1 to
// specific regions, they could be "region-level state cache".

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

// Load map_regions.tga
const tga = fs.readFileSync(REGIONS_TGA);
const tgaW = tga.readUInt16LE(12);
const tgaH = tga.readUInt16LE(14);
console.log(`map_regions: ${tgaW}×${tgaH}`);
const headerSize = 18;
function getPx(x, y) {
  if (x < 0 || x >= tgaW || y < 0 || y >= tgaH) return null;
  const tgaRow = tgaH - 1 - y;
  const off = headerSize + (tgaRow * tgaW + x) * 3;
  return { b: tga[off], g: tga[off + 1], r: tga[off + 2] };
}

// regions_large.json keyed by "B,G,R" (BGR) or "R,G,B"?
const regions = JSON.parse(fs.readFileSync("C:/dev/Provincia/public/regions_large.json", "utf8"));
const keys = Object.keys(regions);
console.log(`regions_large keys: ${keys.length}, first 5: ${keys.slice(0, 5).join(" | ")}`);

// Sample tile (5, 5) and (500, 350) to verify color encoding
const c1 = getPx(5, 5);
const c2 = getPx(500, 350);
console.log(`Pixel (5,5): RGB=${c1.r},${c1.g},${c1.b}`);
console.log(`Pixel (500,350): RGB=${c2.r},${c2.g},${c2.b}`);

// Try (500, 350) key lookups
const try1 = regions[`${c2.r},${c2.g},${c2.b}`];
const try2 = regions[`${c2.b},${c2.g},${c2.r}`];
const try3 = regions[`${c2.g},${c2.r},${c2.b}`];
console.log(`Try RGB string '${c2.r},${c2.g},${c2.b}' → ${JSON.stringify(try1).slice(0, 100)}`);
console.log(`Try BGR string '${c2.b},${c2.g},${c2.r}' → ${try2 ? JSON.stringify(try2).slice(0, 100) : "not found"}`);
console.log(`Try GRB string '${c2.g},${c2.r},${c2.b}' → ${try3 ? JSON.stringify(try3).slice(0, 100) : "not found"}`);

// Sample a few more pixels at known city locations from settlement coords
// settlement coord (252, 457) is "Eastern_Town" — find what region color is there
const p = getPx(252, 457);
console.log(`\nPixel at known settlement (252,457): RGB=${p.r},${p.g},${p.b}`);
const r1 = regions[`${p.r},${p.g},${p.b}`];
console.log(`Lookup 'r,g,b': ${r1 ? JSON.stringify(r1).slice(0, 150) : "not found"}`);
const r1b = regions[`${p.b},${p.g},${p.r}`];
console.log(`Lookup 'b,g,r': ${r1b ? JSON.stringify(r1b).slice(0, 150) : "not found"}`);

// Settlement (291, 405) = chunk[0] = Romans Julii player area
const p2 = getPx(291, 405);
console.log(`\nPixel at Roman (291,405): RGB=${p2.r},${p2.g},${p2.b}`);
const r2 = regions[`${p2.r},${p2.g},${p2.b}`];
console.log(`Lookup: ${r2 ? JSON.stringify(r2).slice(0, 150) : "not found"}`);
const r2b = regions[`${p2.b},${p2.g},${p2.r}`];
console.log(`Lookup BGR: ${r2b ? JSON.stringify(r2b).slice(0, 150) : "not found"}`);

// For each non-canonical cell, get the region color at its center
// And count: which regions have non-canonical cells, which don't?
const PX_W = 1020, PX_H = 700;
const CELL_PX_W = PX_W / W;
const CELL_PX_H = PX_H / H;

const cellRegion = new Map(); // cellIdx → region info
function regionAtCell(cell) {
  const x = Math.round(cell.c * CELL_PX_W + CELL_PX_W / 2);
  const y = Math.round(cell.r * CELL_PX_H + CELL_PX_H / 2);
  const p = getPx(x, y);
  if (!p) return null;
  // Try R,G,B lookup
  let info = regions[`${p.r},${p.g},${p.b}`];
  return { rgb: `${p.r},${p.g},${p.b}`, info };
}

// Count regions covered by non-canonical vs canonical cells
const nonCanRegions = new Map();
for (const c of nonCan) {
  const r = regionAtCell(c);
  if (!r || !r.info) continue;
  const k = r.info.region || r.rgb;
  if (!nonCanRegions.has(k)) nonCanRegions.set(k, { count: 0, info: r.info });
  nonCanRegions.get(k).count++;
}
console.log(`\n--- Non-canonical cell distinct region count: ${nonCanRegions.size} ---`);
const ncTop = [...nonCanRegions.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`Top 20 regions by non-canonical cell count:`);
for (const [k, v] of ncTop.slice(0, 20)) {
  const info = v.info || {};
  console.log(`  ${k.padEnd(35)} ${v.count.toString().padStart(3)} cells | city=${info.city || "?"} faction=${info.faction || "?"} culture=${info.culture || "?"}`);
}

// Same for canonical (sample 700 for fair comparison)
const canRegions = new Map();
const canon = interior.filter(isCanonical);
const sampleC = [];
for (let i = 0; i < Math.min(canon.length, 5000); i++) sampleC.push(canon[i]);
for (const c of sampleC) {
  const r = regionAtCell(c);
  if (!r || !r.info) continue;
  const k = r.info.region || r.rgb;
  if (!canRegions.has(k)) canRegions.set(k, { count: 0, info: r.info });
  canRegions.get(k).count++;
}
console.log(`\nCanonical (sample ${sampleC.length}) distinct regions: ${canRegions.size}`);

// Which regions appear in non-canon but NOT in canon?
const onlyInNonCan = [...nonCanRegions.keys()].filter(k => !canRegions.has(k));
const onlyInCanon = [...canRegions.keys()].filter(k => !nonCanRegions.has(k));
console.log(`Regions ONLY in non-canon: ${onlyInNonCan.length}`);
console.log(`Regions ONLY in canonical: ${onlyInCanon.length}`);
console.log(`Regions in BOTH: ${[...nonCanRegions.keys()].filter(k => canRegions.has(k)).length}`);

// Which non-canon-only regions? Show top 20
console.log(`\nTop 20 non-canon-only regions:`);
for (const k of onlyInNonCan.slice(0, 20)) {
  const v = nonCanRegions.get(k);
  const info = v.info;
  console.log(`  ${k.padEnd(35)} ${v.count.toString().padStart(3)} cells | culture=${info.culture || "?"} faction=${info.faction || "?"}`);
}

// Cultural breakdown
console.log(`\n--- Culture breakdown ---`);
function cultureBreakdown(regionsMap) {
  const cultures = new Map();
  for (const [k, v] of regionsMap) {
    const cult = v.info.culture || "?";
    if (!cultures.has(cult)) cultures.set(cult, 0);
    cultures.set(cult, cultures.get(cult) + v.count);
  }
  return cultures;
}
const ncCult = cultureBreakdown(nonCanRegions);
const canCult = cultureBreakdown(canRegions);
console.log(`Non-canonical:`);
for (const [k, v] of [...ncCult.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`Canonical (sample):`);
for (const [k, v] of [...canCult.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`);
