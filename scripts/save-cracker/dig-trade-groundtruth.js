// dig-trade-groundtruth.js
// Build the resource ground-truth from RIS mod files:
//   1. resource ENUM order from descr_sm_resources.txt (engine resource index)
//   2. per-region resource placements from descr_strat.txt
//        `resource <name>, <qty>, <x>, <y>; <RegionComment>`
//   3. region declaration order from descr_regions.txt (-> regionId candidate)
// Prints a compact table so later digs can validate save bytes against it.
"use strict";
const fs = require("fs");

const RIS = "C:/RIS/RIS/data";
const SM_RES = RIS + "/descr_sm_resources.txt";
const REGIONS = RIS + "/world/maps/base/descr_regions.txt";
const STRAT = RIS + "/world/maps/campaign/imperial_campaign/descr_strat.txt";

// ---- 1. resource enum order (top-level keys until first non-resource tag) ----
// The resource block is the first `"resources": [ ... ]` array; each entry is a
// top-level key `\t"name":`. Trade goods come first, then hidden-resource tags
// (rome, italy, capital, ...). We capture ALL keys in order; the index is the
// engine resource id. We mark which are "real" trade goods (have an icon line).
function parseResourceEnum() {
  const t = fs.readFileSync(SM_RES, "utf8").split(/\r?\n/);
  const names = [];
  let curName = null, curHasIcon = false, depth = 0;
  for (const line of t) {
    const m = line.match(/^\t"([a-z_0-9]+)":\s*$/);
    if (m) { curName = m[1]; curHasIcon = false; }
    if (/"icon":/.test(line)) curHasIcon = true;
    // close of a top-level entry: a `}` at one-tab indent
    if (/^\t\},?\s*$/.test(line) && curName) {
      names.push({ name: curName, tradeGood: curHasIcon });
      curName = null;
    }
  }
  return names;
}

// ---- 3. region declaration order from descr_regions.txt ----
function parseRegions() {
  const lines = fs.readFileSync(REGIONS, "utf8").split(/\r?\n/);
  const out = [];
  const isHdr = (l) => l && !l.startsWith(";") && !/^\s/.test(l) && l.trim().length > 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isHdr(lines[i])) continue;
    const name = lines[i].trim();
    const blk = []; let j = i + 1;
    while (j < lines.length && (/^\s/.test(lines[j]) || lines[j].trim() === "")) { if (lines[j].trim()) blk.push(lines[j].trim()); j++; }
    if (blk.length < 4) continue;
    const rgb = blk[3].split(/\s+/).map(Number);
    if (rgb.length !== 3 || rgb.some(isNaN) || rgb.some(v => v < 0 || v > 255)) continue;
    out.push({ name, settlement: blk[0], owner: blk[1], rgb });
  }
  return out;
}

// ---- 2. per-region resource placements from descr_strat ----
function parseStratResources() {
  const lines = fs.readFileSync(STRAT, "utf8").split(/\r?\n/);
  const byRegion = {}; // regionName -> [{name, qty, x, y}]
  for (const line of lines) {
    const m = line.match(/^resource\s+([a-z_0-9]+),\s*(\d+),\s*(\d+),\s*(\d+);\s*(.+)$/);
    if (!m) continue;
    const [, name, qty, x, y, region] = m;
    const rn = region.trim();
    (byRegion[rn] = byRegion[rn] || []).push({ name, qty: +qty, x: +x, y: +y });
  }
  return byRegion;
}

const resEnum = parseResourceEnum();
const regions = parseRegions();
const stratRes = parseStratResources();

console.log("=== RESOURCE ENUM (engine index) ===");
const tradeGoods = resEnum.filter(r => r.tradeGood);
console.log("total enum entries:", resEnum.length, " trade-goods (with icon):", tradeGoods.length);
console.log(resEnum.map((r, i) => `${i}:${r.name}${r.tradeGood ? "*" : ""}`).join("  "));

console.log("\n=== REGION COUNT ===", regions.length);

console.log("\n=== PER-REGION RESOURCES (first 12 regions) ===");
regions.slice(0, 12).forEach((r, i) => {
  const res = stratRes[r.name] || [];
  console.log(`#${i} ${r.name} (${r.settlement}): ` +
    res.map(x => `${x.name}x${x.qty}@${x.x},${x.y}`).join(", "));
});

// Stats: how many distinct resource types per region, total placements
let totalPlace = 0; const perRegionCount = [];
for (const r of regions) {
  const res = stratRes[r.name] || [];
  totalPlace += res.length;
  perRegionCount.push(res.length);
}
console.log("\ntotal resource placements:", totalPlace,
  " avg/region:", (totalPlace / regions.length).toFixed(1),
  " regions w/ 0:", perRegionCount.filter(c => c === 0).length);

// Export JSON for later digs
fs.writeFileSync(__dirname + "/_trade_groundtruth.json", JSON.stringify({
  resEnum: resEnum.map(r => r.name),
  tradeGoodIdx: resEnum.map((r, i) => r.tradeGood ? i : -1).filter(i => i >= 0),
  regions: regions.map(r => r.name),
  regionSettlement: Object.fromEntries(regions.map(r => [r.name, r.settlement])),
  stratRes,
}, null, 0));
console.log("\nwrote _trade_groundtruth.json");
