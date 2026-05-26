// dig-trade-resource-extract.js
// CRACK CONFIRMED: trade goods are strat-map OBJECTS, stored back-to-back in a
// contiguous array. Each record (24 bytes of payload, records are adjacent):
//   +0  u32 objectUuid
//   +4  u32 0xffffffff   (sentinel / no-parent)
//   +6? actually:
//   layout decoded from windows:
//     [u32 uuid][u32 ffffffff][u8 01][u8 01][u32 resourceId][u32 quantity][u32 x][u32 y]
//   = 2(uuid lo seen) ... let's lock exact stride by scanning.
//
// This script: scan the whole buffer for the record signature
//   <ff ff ff ff> <01 01> <u32 resId in 0..45> <u32 qty 1..9> <u32 x> <u32 y>
// extract every resource object, then validate the MULTISET of
// (resourceId, x, y, qty) against descr_strat ground-truth.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
const GT = JSON.parse(fs.readFileSync(path.join(__dirname, "_trade_groundtruth.json"), "utf8"));
const resEnum = GT.resEnum;

// Build GT multiset keyed by id,x,y -> {name, qty, region}
const gtByXY = new Map(); // "x,y" -> {name,id,qty,region}
const resIdx = Object.fromEntries(resEnum.map((n, i) => [n, i]));
let gtCount = 0;
for (const region of Object.keys(GT.stratRes)) {
  for (const r of GT.stratRes[region]) {
    gtByXY.set(`${r.x},${r.y}`, { name: r.name, id: resIdx[r.name], qty: r.qty, region });
    gtCount++;
  }
}
console.log("GT placements:", gtCount, " distinct xy:", gtByXY.size);

// Scan for the record signature. Signature anchor: ff ff ff ff 01 01 then
// resId(u32)<=45, qty(u32) 1..9, x(u32) 1..600, y(u32) 1..1500.
const records = [];
for (let p = 0; p + 24 < buf.length; p++) {
  if (buf[p] !== 0xff || buf[p + 1] !== 0xff || buf[p + 2] !== 0xff || buf[p + 3] !== 0xff) continue;
  if (buf[p + 4] !== 0x01 || buf[p + 5] !== 0x01) continue;
  const resId = buf.readUInt32LE(p + 6);
  const qty = buf.readUInt32LE(p + 10);
  const x = buf.readUInt32LE(p + 14);
  const y = buf.readUInt32LE(p + 18);
  if (resId > 45) continue;            // trade goods only
  if (qty < 1 || qty > 9) continue;
  if (x < 1 || x > 600) continue;
  if (y < 1 || y > 1500) continue;
  // uuid is the u32 immediately before the sentinel
  const uuid = p >= 4 ? buf.readUInt32LE(p - 4) : 0;
  records.push({ off: p - 4, uuid, resId, qty, x, y });
}
console.log("candidate resource objects found:", records.length);

// Validate against GT
let exact = 0, idMatch = 0, miss = 0;
const wrongId = [];
for (const rec of records) {
  const gt = gtByXY.get(`${rec.x},${rec.y}`);
  if (!gt) { miss++; continue; }
  if (gt.id === rec.resId) {
    idMatch++;
    if (gt.qty === rec.qty) exact++;
  } else {
    wrongId.push({ xy: `${rec.x},${rec.y}`, saveId: rec.resId, saveName: resEnum[rec.resId], gtId: gt.id, gtName: gt.name });
  }
}
console.log(`\nVALIDATION vs descr_strat:`);
console.log(`  records matching a GT (x,y): ${idMatch + wrongId.length}/${records.length}`);
console.log(`  resourceId correct: ${idMatch}`);
console.log(`  resourceId AND qty correct: ${exact}`);
console.log(`  no GT placement at that (x,y): ${miss}`);
console.log(`  wrongId examples:`, wrongId.slice(0, 8));

// Coverage of GT: how many GT placements were found in save
const foundXY = new Set(records.map(r => `${r.x},${r.y}`));
let gtFound = 0;
for (const k of gtByXY.keys()) if (foundXY.has(k)) gtFound++;
console.log(`\nGT coverage: ${gtFound}/${gtByXY.size} GT (x,y) placements present in save`);

// Are records contiguous? Check stride distribution.
records.sort((a, b) => a.off - b.off);
const strides = {};
for (let i = 1; i < records.length; i++) {
  const d = records[i].off - records[i - 1].off;
  strides[d] = (strides[d] || 0) + 1;
}
const topStrides = Object.entries(strides).sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`\ntop strides between consecutive records:`, topStrides.map(([d, c]) => `${d}b×${c}`).join(", "));
console.log(`first record offset: 0x${records[0].off.toString(16)}  last: 0x${records[records.length - 1].off.toString(16)}`);

// Resource id histogram
const idHist = {};
for (const r of records) idHist[r.resId] = (idHist[r.resId] || 0) + 1;
console.log(`\nresource id histogram:`, Object.entries(idHist).sort((a, b) => a[0] - b[0]).map(([id, c]) => `${resEnum[id]}:${c}`).join(" "));
