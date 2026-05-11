// dig-buildchain1.js — Decode the building sub-record structure inside a settlement record.
// Per session 3, each settlement has 5-7 building sub-records like `default_set`, `hinterland_region`,
// `core_building`, `governmentA`, `military_industrial_complex`, each at:
//   [u32 self-ptr][u16 nameLen][ASCIIZ name][payload]
//
// Goal: decode the payload. Hypotheses for the payload:
// - current building chain level (u32 or chain-name)
// - turns remaining (if queued)
// - last-built turn
// - damage state, health

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
// saveturn1building has a construction project started; should help us find queue counter
const F_BASE = "0007_save_saveturn1building.sav";
const F_CONSTR = "0008_save_saveturn1construction.sav";  // construction in progress
const F_START = "0010_save_saveturn1start.sav";

const baseBuf = fs.readFileSync(path.join(ARCHIVE, F_BASE));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, F_CONSTR));
const startBuf = fs.readFileSync(path.join(ARCHIVE, F_START));

console.log(`base: ${baseBuf.length}, constr: ${constrBuf.length}, start: ${startBuf.length}`);

// Find all 'default_set' positions in each save
function findToken(buf, tok) {
  const out = [];
  let p = 0;
  const t = Buffer.from(tok);
  while ((p = buf.indexOf(t, p)) !== -1) {
    out.push(p);
    p += 1;
  }
  return out;
}

// Look for building chain names
const TOKS = [
  "default_set", "hinterland_region", "core_building", "governmentA", "governmentB",
  "governmentC", "governmentD", "military_industrial_complex", "hinterland_roads",
  "port_buildings", "town_walls", "theatres", "academia"
];

for (const f of [F_START, F_BASE, F_CONSTR]) {
  const buf = fs.readFileSync(path.join(ARCHIVE, f));
  console.log(`\n${f}: ${buf.length} bytes`);
  for (const t of TOKS) {
    const hits = findToken(buf, t);
    if (hits.length > 0) console.log(`  ${t}: ${hits.length} hits`);
  }
}

// Now: pick the FIRST default_set hit in saveturn1start and dump structure around it
const startHits = findToken(startBuf, "default_set");
console.log(`\nFirst 'default_set' in saveturn1start at offset 0x${startHits[0].toString(16)}`);
const off = startHits[0];
// Dump 64 bytes before (-2 for nameLen, etc.) and 200 bytes after
const dumpStart = off - 6;
const dumpEnd = off + 200;
console.log(`Dump 0x${dumpStart.toString(16)}..0x${dumpEnd.toString(16)}:`);
for (let i = dumpStart; i < dumpEnd; i += 16) {
  const row = [];
  const asc = [];
  for (let j = 0; j < 16 && i + j < dumpEnd; j++) {
    const b = startBuf[i + j];
    row.push(b.toString(16).padStart(2, "0"));
    asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
  }
  console.log(`  ${i.toString(16).padStart(8, "0")}: ${row.join(" ")}  | ${asc.join("")}`);
}
