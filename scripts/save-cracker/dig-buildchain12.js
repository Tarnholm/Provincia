// dig-buildchain12.js — Compare Pella's default_set payload across THREE saves: start, building, construction.
// saveturn1building.sav is only 6 bytes larger than start, while construction is 900 bytes larger.

const fs = require("fs");
const path = require("path");

const ARCHIVE = "C:/dev/Provincia/calibration/archive/2026-04-21T22-49-17-100Z";
const startBuf = fs.readFileSync(path.join(ARCHIVE, "0010_save_saveturn1start.sav"));
const buildBuf = fs.readFileSync(path.join(ARCHIVE, "0007_save_saveturn1building.sav"));
const constrBuf = fs.readFileSync(path.join(ARCHIVE, "0008_save_saveturn1construction.sav"));

// Find Pella default_set in each
function findFirst(buf, tok) {
  const t = Buffer.from(tok);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (p - 2 >= 0 && buf.readUInt16LE(p - 2) === tok.length + 1 && buf[p + tok.length] === 0) return p;
    p += 1;
  }
  return -1;
}

// Find ALL default_set occurrences (we want #1 = Pella)
function findAll(buf, tok) {
  const out = [];
  const t = Buffer.from(tok);
  let p = 0;
  while ((p = buf.indexOf(t, p)) !== -1) {
    if (p - 2 >= 0 && buf.readUInt16LE(p - 2) === tok.length + 1 && buf[p + tok.length] === 0) out.push(p);
    p += 1;
  }
  return out;
}

const sAll = findAll(startBuf, "default_set");
const bAll = findAll(buildBuf, "default_set");
const cAll = findAll(constrBuf, "default_set");

console.log(`Pella default_set positions:`);
console.log(`  start: 0x${sAll[1].toString(16)}`);
console.log(`  build: 0x${bAll[1].toString(16)}`);
console.log(`  constr: 0x${cAll[1].toString(16)}`);

// Pella's default_set payload starts at (offset + 12)
function dumpPayload(buf, name, off, len) {
  const p = off + 12;
  console.log(`\n=== ${name} payload (${len}b): ===`);
  for (let i = 0; i < len; i += 16) {
    const hex = [], asc = [];
    for (let j = 0; j < 16 && i + j < len; j++) {
      const b = buf[p + i + j];
      hex.push(b.toString(16).padStart(2, "0"));
      asc.push((b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".");
    }
    console.log(`  +${i.toString().padStart(3)}: ${hex.join(" ").padEnd(48)} | ${asc.join("")}`);
  }
}

// Find size of each Pella default_set payload (= start of next sub-record - 6 - payload start)
function findNextSubAfter(buf, off) {
  // Look for any building-chain name (in known list) AFTER off
  const NAMES = ["core_building", "hinterland_region", "governmentA", "governmentB", "governmentC", "governmentD", "military_industrial_complex", "hinterland_roads", "port_buildings", "town_walls", "theatres", "defenses", "barracks", "missiles", "market"];
  let earliest = Infinity;
  for (const n of NAMES) {
    const t = Buffer.from(n);
    const p = buf.indexOf(t, off + 1);
    if (p > off && p < earliest) earliest = p;
  }
  return earliest;
}

const sNext = findNextSubAfter(startBuf, sAll[1]);
const bNext = findNextSubAfter(buildBuf, bAll[1]);
const cNext = findNextSubAfter(constrBuf, cAll[1]);
console.log(`\nNext sub-record:`);
console.log(`  start: 0x${sNext.toString(16)} (= ${sNext - sAll[1] - 12} payload bytes)`);
console.log(`  build: 0x${bNext.toString(16)} (= ${bNext - bAll[1] - 12} payload bytes)`);
console.log(`  constr: 0x${cNext.toString(16)} (= ${cNext - cAll[1] - 12} payload bytes)`);

// Subtract 6 (the u32 self-ptr + u16 nameLen of NEXT sub-record) from the absolute position to get the
// END of THIS sub-record's payload.
const sPL = sNext - sAll[1] - 12 - 6;
const bPL = bNext - bAll[1] - 12 - 6;
const cPL = cNext - cAll[1] - 12 - 6;
console.log(`\nPayload sizes:`);
console.log(`  start: ${sPL}`);
console.log(`  build: ${bPL}`);
console.log(`  constr: ${cPL}`);

dumpPayload(startBuf, "START", sAll[1], sPL);
dumpPayload(buildBuf, "BUILD", bAll[1], bPL);
dumpPayload(constrBuf, "CONSTR", cAll[1], cPL);
