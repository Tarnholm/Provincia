// dig-midfile-aizone4.js — CONFIRM: non-canonical cells = edge/distant regions in map.
// Test: are all non-canonical cells in regions with faction in {massylii, saka, siraces, suebi, lugii, trinovantes}?
// These are RIS's distant/barbarian factions that AI rarely interacts with.

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
  return { b: tga[off], g: tga[off + 1], r: tga[off + 2] };
}
const regions = JSON.parse(fs.readFileSync("C:/dev/Provincia/public/regions_large.json", "utf8"));

const PX_W = 1020, PX_H = 700;
const CELL_PX_W = PX_W / W;
const CELL_PX_H = PX_H / H;

function getRegionAt(cell) {
  const x = Math.round(cell.c * CELL_PX_W + CELL_PX_W / 2);
  const y = Math.round(cell.r * CELL_PX_H + CELL_PX_H / 2);
  const p = getPx(x, y);
  if (!p) return { x, y, info: null, rgb: null };
  const rgb = `${p.r},${p.g},${p.b}`;
  return { x, y, info: regions[rgb] || null, rgb };
}

// Count faction-coverage in non-canonical vs canonical
const ncFactions = new Map(); // faction → count
const ncCultures = new Map();
const ncSea = new Map(); // sea-pixel rgb
for (const c of nonCan) {
  const r = getRegionAt(c);
  if (!r.info) {
    if (!ncSea.has(r.rgb)) ncSea.set(r.rgb, 0);
    ncSea.set(r.rgb, ncSea.get(r.rgb) + 1);
    continue;
  }
  const f = r.info.faction || "?";
  const k = r.info.culture || "?";
  ncFactions.set(f, (ncFactions.get(f) || 0) + 1);
  ncCultures.set(k, (ncCultures.get(k) || 0) + 1);
}
const canFactions = new Map();
const canCultures = new Map();
const canSea = new Map();
for (const c of canon) {
  const r = getRegionAt(c);
  if (!r.info) {
    if (!canSea.has(r.rgb)) canSea.set(r.rgb, 0);
    canSea.set(r.rgb, canSea.get(r.rgb) + 1);
    continue;
  }
  const f = r.info.faction || "?";
  const k = r.info.culture || "?";
  canFactions.set(f, (canFactions.get(f) || 0) + 1);
  canCultures.set(k, (canCultures.get(k) || 0) + 1);
}

console.log(`\n--- Faction representation ---`);
console.log(`Non-canonical: ${nonCan.length} cells, ${[...ncSea.values()].reduce((s,v)=>s+v,0)} sea, ${[...ncFactions.values()].reduce((s,v)=>s+v,0)} land`);
console.log(`Canonical:     ${canon.length} cells, ${[...canSea.values()].reduce((s,v)=>s+v,0)} sea, ${[...canFactions.values()].reduce((s,v)=>s+v,0)} land`);

console.log(`\nFaction representation rate (#cells / total non-can-land):`);
const ncTotalLand = [...ncFactions.values()].reduce((s,v)=>s+v,0);
const canTotalLand = [...canFactions.values()].reduce((s,v)=>s+v,0);
// All factions encountered in either
const allFactions = new Set([...ncFactions.keys(), ...canFactions.keys()]);
const factionData = [];
for (const f of allFactions) {
  const nc = ncFactions.get(f) || 0;
  const cn = canFactions.get(f) || 0;
  const ncFrac = nc / ncTotalLand;
  const cnFrac = cn / canTotalLand;
  const ratio = cnFrac > 0 ? ncFrac / cnFrac : Infinity;
  factionData.push({ f, nc, cn, ncFrac, cnFrac, ratio });
}
factionData.sort((a, b) => b.ratio - a.ratio);
console.log(`(ratio > 1 = over-represented in non-canonical)`);
console.log(`Faction              | non-can | canon | ncFrac% | cnFrac% | ratio`);
for (const d of factionData.slice(0, 30)) {
  console.log(`  ${d.f.padEnd(20)} ${d.nc.toString().padStart(5)} ${d.cn.toString().padStart(7)} ${(d.ncFrac*100).toFixed(2).padStart(7)}% ${(d.cnFrac*100).toFixed(2).padStart(7)}% ${d.ratio.toFixed(2)}`);
}

console.log(`\n--- Reverse: factions only in canonical ---`);
for (const d of factionData.slice(-10)) {
  console.log(`  ${d.f.padEnd(20)} ${d.nc.toString().padStart(5)} ${d.cn.toString().padStart(7)} ${(d.ncFrac*100).toFixed(2).padStart(7)}% ${(d.cnFrac*100).toFixed(2).padStart(7)}% ${d.ratio.toFixed(2)}`);
}

// Total faction count
console.log(`\nTotal distinct factions in non-canonical: ${ncFactions.size}`);
console.log(`Total distinct factions in canonical: ${canFactions.size}`);

// Per session 22 RIS major-faction count is 23. Check overlap.
const majorFactions = new Set(["romans_julii", "carthage", "egypt", "greeks", "seleucid", "macedon", "pontus", "armenia", "parthia", "scythia", "germans", "gauls", "britons", "spain", "thrace", "dacia", "numidia", "saka", "iberi", "lusitani"]);
console.log(`\nNon-canon: ${[...ncFactions.keys()].filter(f => majorFactions.has(f)).length} major factions out of ${ncFactions.size}`);
console.log(`Canonical: ${[...canFactions.keys()].filter(f => majorFactions.has(f)).length} major factions out of ${canFactions.size}`);

// Map dimensions sanity-check
// Settlement coord X[83..988], Y[22..651] = same TGA pixel space
// Cell c×4.25 ≈ TGA px X, r×2.94 ≈ TGA px Y → cell (c=20)≈X=85, cell (r=8)≈Y=24 → near settlement minimum

// Let's tabulate the actual y coordinates of non-canon vs canon
const ncY = nonCan.map(c => c.r);
const canY = canon.map(c => c.r);
function pct(arr, p) { const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length*p)]; }
console.log(`\nRow (y) distribution:`);
console.log(`  Non-canonical: min=${Math.min(...ncY)} p25=${pct(ncY,0.25)} p50=${pct(ncY,0.5)} p75=${pct(ncY,0.75)} max=${Math.max(...ncY)}`);
console.log(`  Canonical: min=${Math.min(...canY)} p25=${pct(canY,0.25)} p50=${pct(canY,0.5)} p75=${pct(canY,0.75)} max=${Math.max(...canY)}`);

const ncX = nonCan.map(c => c.c);
const canX = canon.map(c => c.c);
console.log(`\nCol (x) distribution:`);
console.log(`  Non-canonical: min=${Math.min(...ncX)} p25=${pct(ncX,0.25)} p50=${pct(ncX,0.5)} p75=${pct(ncX,0.75)} max=${Math.max(...ncX)}`);
console.log(`  Canonical: min=${Math.min(...canX)} p25=${pct(canX,0.25)} p50=${pct(canX,0.5)} p75=${pct(canX,0.75)} max=${Math.max(...canX)}`);
