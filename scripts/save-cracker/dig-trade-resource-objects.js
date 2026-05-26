// dig-trade-resource-objects.js
// Hypothesis: trade goods are serialized as strat-map OBJECTS (resource_type,
// x, y, quantity) — not as a region attribute. descr_strat gives the exact
// placement (name, qty, x, y). Search the save for those (x,y) tile pairs and
// inspect the surrounding bytes for: the resource enum id (0..45), the qty,
// and a possible owner/trade field.
//
// Strategy: take a handful of distinctive placements (rare resource + unusual
// coords), build candidate byte patterns for x,y as u32 LE adjacent, and as
// u16, locate them, then print a window and check whether a nearby byte equals
// the resource enum id and another equals qty.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const buf = fs.readFileSync(SAVE);
const GT = JSON.parse(fs.readFileSync(path.join(__dirname, "_trade_groundtruth.json"), "utf8"));
const resEnum = GT.resEnum;
const resIdx = Object.fromEntries(resEnum.map((n, i) => [n, i]));

// Pick distinctive placements to probe (rare goods, distinct coords).
const probes = [];
for (const region of Object.keys(GT.stratRes)) {
  for (const r of GT.stratRes[region]) {
    probes.push({ region, ...r, id: resIdx[r.name] });
  }
}
console.log("total placements:", probes.length);

// --- find (x,y) adjacency as u32 LE pair ---
function findU32Pair(x, y) {
  const out = [];
  const needle = Buffer.alloc(8);
  needle.writeUInt32LE(x, 0); needle.writeUInt32LE(y, 4);
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { out.push(p); p += 1; if (out.length > 50) break; }
  return out;
}
function findU16Pair(x, y) {
  const out = [];
  const needle = Buffer.alloc(4);
  needle.writeUInt16LE(x, 0); needle.writeUInt16LE(y, 2);
  let p = 0;
  while ((p = buf.indexOf(needle, p)) !== -1) { out.push(p); p += 1; if (out.length > 200) break; }
  return out;
}

// Probe a few specific, rare placements.
const samples = probes.filter(p =>
  (p.region === "Roma" && p.name === "glass") ||
  (p.region === "Etruria" && p.name === "iron") ||
  (p.region === "Taras" && p.name === "purple_dye") ||
  (p.region === "Campania" && p.name === "perfumes")
);

for (const s of samples) {
  console.log(`\n=== ${s.region} ${s.name} (id=${s.id}) qty=${s.qty} @ ${s.x},${s.y} ===`);
  const u32hits = findU32Pair(s.x, s.y);
  console.log(`  u32 (x,y) adjacency hits: ${u32hits.length}`, u32hits.slice(0, 8).map(h => "0x" + h.toString(16)));
  const u16hits = findU16Pair(s.x, s.y);
  console.log(`  u16 (x,y) adjacency hits: ${u16hits.length}`, u16hits.slice(0, 12).map(h => "0x" + h.toString(16)));
  // For each u32 hit, dump a window and look for enum id / qty nearby
  for (const h of u32hits.slice(0, 4)) {
    const winS = Math.max(0, h - 16);
    const bytes = [];
    for (let i = winS; i < Math.min(buf.length, h + 24); i++) bytes.push(buf[i].toString(16).padStart(2, "0"));
    console.log(`    u32@0x${h.toString(16)}: [${bytes.join(" ")}]  (x,y start at offset ${h - winS})`);
  }
  for (const h of u16hits.slice(0, 6)) {
    const winS = Math.max(0, h - 12);
    const bytes = [];
    for (let i = winS; i < Math.min(buf.length, h + 16); i++) bytes.push(buf[i].toString(16).padStart(2, "0"));
    console.log(`    u16@0x${h.toString(16)}: [${bytes.join(" ")}]`);
  }
}
