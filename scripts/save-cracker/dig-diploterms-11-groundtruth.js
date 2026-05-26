// dig-diploterms-11-groundtruth.js
// Cross-reference zone class/attitude distributions with descr_strat ground
// truth. Count per-faction relationships from descr_strat and compare to zone
// entry counts. Also tabulate class x attitude combos.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii","romans_brutii","romans_scipii","romans_senate","macedon","egypt",
  "seleucid","carthage","parthia","pontus","gauls","germans","britons","armenia",
  "dacia","greek_cities","numidia","scythia","spain","thrace","slave"];
const MARKER = 0x39240005;

function findZones(buf) {
  const seen = new Map();
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const fid = buf[i - 53];
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o + 4), attitude: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (!ok) continue;
    if (!seen.has(fid) || seen.get(fid).count < count) seen.set(fid, { fid, count, entries });
  }
  return seen;
}

const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const zones = findZones(buf);

console.log("=== Per-faction zone: class:att combos ===");
for (let fid = 0; fid < 21; fid++) {
  const z = zones.get(fid);
  if (!z) { console.log(`  ${VANILLA_ORDER[fid]}: NO ZONE`); continue; }
  const combos = z.entries.map(e => `c${e.class_}a${e.attitude}`).sort();
  const tally = {};
  combos.forEach(c => tally[c] = (tally[c]||0)+1);
  console.log(`  ${VANILLA_ORDER[fid].padEnd(15)} cnt=${String(z.count).padStart(2)}: ${Object.entries(tally).map(([k,v])=>`${k}x${v}`).join(" ")}`);
}

// class x attitude matrix
console.log("\n=== class x attitude matrix (all NPC zones, tag=0x10101) ===");
const mat = {};
for (const z of zones.values()) for (const e of z.entries) {
  if (e.tag !== 0x10101) continue;
  const k = `c${e.class_}`;
  mat[k] = mat[k] || {};
  mat[k][`a${e.attitude}`] = (mat[k][`a${e.attitude}`]||0)+1;
}
const atts = ["a0","a1","a2","a3","a4","a5"];
console.log("        " + atts.map(a=>a.padStart(5)).join(""));
for (const c of ["c0","c1","c2","c4","c5"]) {
  const row = atts.map(a => String((mat[c]&&mat[c][a])||0).padStart(5)).join("");
  console.log(`  ${c.padEnd(6)}${row}`);
}
