// dig-path-cache4.js — Map chunk indices to factions using session 16's centroid info.
// Examine chunk[0] (Romans Julii / player) and chunk[5] (Macedon? Pontus?) in detail.

const fs = require("fs");
const buf = fs.readFileSync("C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_rome10.sav");

function parseTrail(start) {
  const chunks = [];
  let p = start;
  while (p + 4 < buf.length) {
    const N = buf.readUInt32LE(p);
    if (N === 0) { p += 4; continue; }
    if (N > 200) break;
    const cs = p;
    p += 4;
    const recs = [];
    let ok = true;
    for (let i = 0; i < N; i++) {
      const sp = buf.readUInt32LE(p);
      const pc = buf.readUInt16LE(p + 4);
      if (sp !== p || pc > 100) { ok = false; break; }
      const pairs = [];
      p += 6;
      for (let j = 0; j < pc; j++) {
        const x = buf.readUInt32LE(p);
        const y = buf.readUInt32LE(p + 4);
        pairs.push({ x, y });
        p += 8;
      }
      recs.push({ off: sp, pc, pairs });
    }
    if (!ok) { p = cs; break; }
    chunks.push({ N, recs, start: cs });
  }
  return chunks;
}

const trail = parseTrail(0x2110a24);
console.log(`${trail.length} chunks`);

// For each chunk: centroid of all coords
function centroid(coords) {
  if (coords.length === 0) return null;
  const cx = coords.reduce((s, p) => s + p.x, 0) / coords.length;
  const cy = coords.reduce((s, p) => s + p.y, 0) / coords.length;
  return { x: cx, y: cy };
}

const chunkInfo = trail.map((c, i) => {
  const all = c.recs.flatMap(r => r.pairs);
  return { idx: i, N: c.N, nonEmpty: c.recs.filter(r => r.pc > 0).length, coords: all, centroid: centroid(all) };
});

console.log("\n--- All chunks with non-empty trails ---");
for (const ci of chunkInfo) {
  if (ci.nonEmpty === 0) continue;
  console.log(`  chunk[${ci.idx.toString().padStart(3)}] N=${ci.N.toString().padStart(3)} nonEmpty=${ci.nonEmpty.toString().padStart(3)} centroid=(${ci.centroid.x.toFixed(0)},${ci.centroid.y.toFixed(0)})`);
}

// Session 16 said chunk[0]=(291,405)=Italy/Rome/player, chunk[5]=(397,378)=Macedon big, chunk[7]=(513,362)=Seleucid central Asia.
// Cross-reference: load settlement-region map from regions_large.json + descr_strat_buildings_large.json
// to compute "what faction owns each tile coord". For each chunk centroid, find nearest settlement & report.

// Load the (X,Y) → faction map from descr_strat_buildings_large.json
const dsb = JSON.parse(fs.readFileSync("C:/dev/Provincia/public/descr_strat_buildings_large.json", "utf8"));
// dsb is array of {faction, settlements:[{region,...}]}
// regions_large.json keyed by RGB has {region, city, faction}
const regions = JSON.parse(fs.readFileSync("C:/dev/Provincia/public/regions_large.json", "utf8"));
// regions[rgbKey] = {region, city, faction, ...}
// We need (X,Y) — but regions_large.json doesn't have coords. Only RGB region colors.
// The save's settlement-model block at 0x1f47809 has 201 (X,Y) coords. Each maps to a settlement.

// Get the model block coords with their model names
function isModelChar(b) { return (b>=0x41&&b<=0x5a)||(b>=0x61&&b<=0x7a)||(b>=0x30&&b<=0x39)||b===0x5f; }
const knownModels = new Set(["W_hellenistic_Large_Town","W_hellenistic_Large_City","Celtic_Large_Town","W_hellenistic_City","Eastern_Large_Town","Illyrian_Large_Town","W_hellenistic_Town","Celtic_City","W_hellenistic_Huge_City","Carthaginian_Huge_City","Carthaginian_Large_Town","Eastern_City","Germanic_Large_Town","Nomad_Large_Town","Eastern_Town","Eastern_Huge_City","Carthaginian_City","Egyptian_Large_Town","Celtic_Town","Carthaginian_Town","Egyptian_Town","Illyrian_Town","Germanic_Town","Nomad_Town"]);

const modelByCoord = new Map(); // "x,y" → [model names]
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
  if (!modelByCoord.has(k)) modelByCoord.set(k, []);
  modelByCoord.get(k).push(nm);
  p = postName - 1;
}
console.log(`\nDistinct model-block coords: ${modelByCoord.size}`);

// For each chunk, find nearest model coord
function dist(a, b) { return Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)); }
const modelPoints = [...modelByCoord.entries()].map(([k, ms]) => {
  const [x, y] = k.split(",").map(Number);
  return { x, y, ms };
});

console.log("\n--- Each non-empty chunk's centroid → nearest settlement ---");
for (const ci of chunkInfo) {
  if (ci.nonEmpty === 0) continue;
  if (!ci.centroid) continue;
  // Find nearest model-coord to centroid
  let best = null, bd = Infinity;
  for (const m of modelPoints) {
    const d = dist(ci.centroid, m);
    if (d < bd) { bd = d; best = m; }
  }
  // Also check: how many coords in this chunk are EXACTLY at a model coord
  const coordSet = new Set(ci.coords.map(c => `${c.x},${c.y}`));
  const settHits = [...coordSet].filter(c => modelByCoord.has(c)).length;
  console.log(`  chunk[${ci.idx.toString().padStart(3)}] N=${ci.N.toString().padStart(3)} nonEmpty=${ci.nonEmpty.toString().padStart(3)} centroid=(${ci.centroid.x.toFixed(0)},${ci.centroid.y.toFixed(0)}) → nearest=(${best.x},${best.y}) d=${bd.toFixed(1)} models=${best.ms.slice(0,3).join("|")} | trailCoords@settlements=${settHits}/${coordSet.size}`);
}

// Hypothesis check: each chunk's nonEmpty count vs faction's army count?
// Per session 22, the 23 major factions have player + 22 AI. RIS has 23+216=239 total.
// Trail has 221 chunks. Close to faction count (239).
// Major factions with active state in trail might be limited — e.g. 23 majors all have trails, minors mostly empty.
// Check: non-empty chunks count = 72. That's between 23 (majors) and 122 (field armies).

// Total nonEmpty trails: 256
// Total trail records: 2503
// Total chunks: 221
// Field-army tail records: 122
// Major factions: 23
// Minor factions: 216
// 23 + 216 = 239
// 122 field armies map to non-faction armies (rebels/hordes per session 14)
// So the trail chunks DON'T map to field-army; they map to ~221 factions (very close to 239)

console.log("\n--- Hypothesis summary ---");
console.log(`Total chunks: ${trail.length}`);
console.log(`Total non-empty trails: 256`);
console.log(`Total field armies (tail): 122`);
console.log(`Faction count (RIS major+minor): 239`);
console.log(`Match between 221 chunks and 239 factions: close, but 18 short. Possibly only "alive" factions emit chunks.`);
console.log(`Match between 122 field armies and 256 non-empty trails: poor (256 not 122).`);
