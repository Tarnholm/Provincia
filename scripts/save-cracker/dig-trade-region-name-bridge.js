// dig-trade-region-name-bridge.js
// Bridge regionId -> settlement/region NAME so resource validation is possible.
// Approach: settlement records carry the UTF-16 settlement name + a stats block
// (memory: name-583..name). The region record (geometry, regionId@+12) and the
// settlement record for the same province are serialised near each other. We
// pair each region record with the nearest following settlement name, then map
// settlement name -> region name via descr_regions (modRegionToCity inverse).
"use strict";
const fs = require("fs");
const X = require("../../src/saveCrackerExtras.js");
const { findAllSettlementMarkers } = require("../../src/buildingParser.js");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);

// settlement name -> region name from descr_regions (parsed inline)
function parseRegions() {
  const t = fs.readFileSync("C:/RIS/RIS/data/world/maps/base/descr_regions.txt", "utf8");
  const lines = t.split(/\r?\n/);
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
const regions = parseRegions();
const cityToRegion = {};
for (const r of regions) cityToRegion[r.settlement] = r.name;

const settlements = findAllSettlementMarkers(buf)
  .filter(s => cityToRegion[s.name]) // keep only real settlements (in descr_regions)
  .sort((a, b) => a.offset - b.offset);
console.log("settlement markers matching descr_regions:", settlements.length);

let regs = X.findRegionRecords(buf).filter(r => r.regionId > 0 && r.regionId < 2000).sort((a, b) => a.offset - b.offset);
console.log("region records:", regs.length);

// Pair: for each region record, nearest settlement marker AFTER it (within 50KB)
const pairs = [];
for (const r of regs) {
  let best = null;
  for (const s of settlements) {
    if (s.offset > r.offset) { best = s; break; }
  }
  if (best && best.offset - r.offset < 50000) {
    pairs.push({ regionId: r.regionId, off: r.offset, city: best.name, region: cityToRegion[best.name], dist: best.offset - r.offset });
  }
}
console.log("paired:", pairs.length);
// Dedup: a regionId should map to one city. Count consistency.
const byId = {};
for (const p of pairs) { (byId[p.regionId] = byId[p.regionId] || []).push(p.region); }
let consistent = 0, total = 0;
for (const id of Object.keys(byId)) {
  total++;
  const uniq = new Set(byId[id]);
  if (uniq.size === 1) consistent++;
}
console.log(`regionId->region consistency: ${consistent}/${total} unique-mapped`);
console.log("sample pairs:", JSON.stringify(pairs.slice(0, 12)));
