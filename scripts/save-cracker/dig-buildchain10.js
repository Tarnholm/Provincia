// dig-buildchain10.js — Use a different approach: look at the structure changes within Pella by
// finding the BUILDING SUB-RECORDS in BOTH saves and matching them up.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

function findAllInRange(buf, tok, lo, hi) {
  const out = [];
  const t = Buffer.from(tok);
  let p = lo;
  while ((p = buf.indexOf(t, p)) !== -1 && p < hi) {
    if (p - 2 >= 0 && buf.readUInt16LE(p - 2) === tok.length + 1 && buf[p + tok.length] === 0) out.push(p);
    p += 1;
  }
  return out;
}

const PELLA_S = 0x10dae, PELLA_END_S = 0x1157e;
const PELLA_C = 0x10dae, PELLA_END_C = 0x115b3;

// Find all sub-record names in both saves' Pella ranges
const NAMES = ["default_set", "hinterland_region", "core_building", "governmentA", "governmentB", "governmentC", "governmentD", "military_industrial_complex", "hinterland_roads", "port_buildings", "town_walls", "theatres", "academia", "defenses", "barracks", "missiles", "market", "trader", "shrine", "core_walls", "smiths", "core_building_temple", "amphitheatres", "racing", "horse_breeders", "guilds", "ports", "trade", "markets", "mines", "religious", "hinterland_farms", "core_building_high_resource", "stoneworks", "metalworks"];

console.log("Pella START sub-records (in order):");
const startSubs = [];
for (const n of NAMES) {
  for (const off of findAllInRange(startBuf, n, PELLA_S, PELLA_END_S)) {
    startSubs.push({ name: n, off });
  }
}
startSubs.sort((a, b) => a.off - b.off);
for (const s of startSubs) console.log(`  @0x${s.off.toString(16)} (+${s.off-PELLA_S}) ${s.name}`);

console.log("\nPella CONSTR sub-records (in order):");
const constrSubs = [];
for (const n of NAMES) {
  for (const off of findAllInRange(constrBuf, n, PELLA_C, PELLA_END_C)) {
    constrSubs.push({ name: n, off });
  }
}
constrSubs.sort((a, b) => a.off - b.off);
for (const s of constrSubs) console.log(`  @0x${s.off.toString(16)} (+${s.off-PELLA_C}) ${s.name}`);
