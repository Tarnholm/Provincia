// dig-diplomacy16.js — Session 31: identify each major faction by its homeland fingerprint.
// Match against descr_strat-derived starting regions.

import fs from "node:fs";

const SAVE_A = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.sav";

function findMajorRecords(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i++) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    const treasury = buf.readInt32LE(i);
    out.push({ pos: i, treasury, regions });
    i += 60;
  }
  return out;
}

const buf = fs.readFileSync(SAVE_A);
const recs = findMajorRecords(buf);

// Build the parsed factions_with_regions map name → set-of-regions
// then we need region names → numeric IDs.
// Actually first dump the region lists per record to deduce the naming.

console.log("=== Major record region lists ===\n");
for (let idx = 0; idx < recs.length; idx++) {
  const r = recs[idx];
  const list = [];
  for (let k = 0; k < r.regions; k++) {
    list.push(buf.readUInt32LE(r.pos + 52 + k * 4));
  }
  console.log(`[${idx}] pos=0x${r.pos.toString(16)} treasury=${r.treasury} regions=${r.regions}`);
  console.log(`     ${list.sort((a,b)=>a-b).join(",")}`);
}
