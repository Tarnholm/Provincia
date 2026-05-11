// dig-uria-buildings.js
// Re-check session 34 claim that exterminate doesn't damage buildings.
// Enumerate every chain record in Uria's settlement block in save_11.1
// (occupy baseline) and save_12.1 (exterminate). For each chain record
// dump the HP byte at offsets +0x24..+0x34 from the cstring start, so we
// can pinpoint the actual HP location even if session 17's +0x28 is wrong
// for the chain category here.

"use strict";

const fs = require("fs");
const path = require("path");

// Pull in the parser via require — buildingParser.js uses CommonJS module.exports.
const { findAllSettlementMarkers, scanChainsBetween } = require(
  path.resolve("C:/dev/Provincia/src/buildingParser.js")
);

const SAVES_DIR =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/";

const files = ["save_9.1.sav", "save_10.1.sav", "save_11.1.sav", "save_12.1.sav"];

function loadValidChainNames() {
  // Use building_levels.json — keys are chain names.
  const p = "C:/dev/Provincia/public/building_levels.json";
  if (!fs.existsSync(p)) return null;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  if (Array.isArray(j)) return new Set(j);
  if (typeof j === "object") return new Set(Object.keys(j));
  return null;
}

const validChainNames = loadValidChainNames();
console.log(
  "validChainNames",
  validChainNames ? `size=${validChainNames.size}` : "null"
);

function dumpHex(buf, off, len) {
  const e = Math.min(off + len, buf.length);
  const parts = [];
  for (let i = off; i < e; i++) {
    parts.push(buf[i].toString(16).padStart(2, "0"));
  }
  return parts.join(" ");
}

function rec(buf, file) {
  const fp = path.join(SAVES_DIR, file);
  const buf2 = buf || fs.readFileSync(fp);
  const markers = findAllSettlementMarkers(buf2);
  const uria = markers.filter((m) => m.name === "Uria");
  console.log(`\n=== ${file} ===`);
  console.log(`  buf size: ${buf2.length}`);
  console.log(`  total settlement markers: ${markers.length}`);
  console.log(`  uria markers: ${uria.length}`);
  for (const u of uria) {
    console.log(`  uria @ 0x${u.offset.toString(16)} blockEnd 0x${u.blockEnd.toString(16)}`);
  }
  if (uria.length === 0) return;
  // For each Uria marker, find its prev marker's blockEnd.
  for (const u of uria) {
    // Find the marker immediately preceding u in the full marker list.
    const idx = markers.indexOf(u);
    const prevEnd = idx === 0 ? 0 : markers[idx - 1].blockEnd;
    console.log(
      `\n  Uria @ 0x${u.offset.toString(16)}: scanning chains in [0x${prevEnd.toString(16)}, 0x${u.offset.toString(16)})  (${u.offset - prevEnd} bytes)`
    );
    const chains = scanChainsBetween(buf2, prevEnd, u.offset, validChainNames, null);
    console.log(`    chains found: ${chains.length}`);
    for (const c of chains) {
      // c.offset = record start (uint16 length prefix).
      // cstring start = c.offset + 2.
      // Parser's HP rule: healthAbs = c.offset + name.length + 32.
      //   = cstring_start + name.length + 30
      //   = (record_start + 2 + name.length + 1[null] + 4[hash]) + 23
      //   = (post-hash byte) + 23
      // Per session 17 brief, HP is at "+0x28 from cstring start" — but the
      // parser actually uses c.offset + name.length + 32. Test both.
      const cstr = c.offset + 2;
      const parserHpOff = c.offset + c.name.length + 32;
      const session17HpOff = cstr + 0x28;
      // Wider context window — 40 bytes starting from post-hash byte.
      const postHash = cstr + c.name.length + 1 + 4; // hash starts at cstr+name.length+1
      const ctx = dumpHex(buf2, postHash, 40);
      console.log(
        `    chain  @ 0x${c.offset.toString(16).padStart(7, "0")}  size=${String(c.size).padStart(4)}  level=${c.level}  name=${c.name}`
      );
      console.log(
        `       cstr=0x${cstr.toString(16)}  parser_hp(record+name+32)=${buf2[parserHpOff]} @0x${parserHpOff.toString(16)}  ` +
          `session17_hp(cstr+0x28)=${buf2[session17HpOff]} @0x${session17HpOff.toString(16)}`
      );
      console.log(
        `       around: cstr+0x20=${buf2[cstr + 0x20]} +0x24=${buf2[cstr + 0x24]} +0x28=${buf2[cstr + 0x28]} +0x2C=${buf2[cstr + 0x2c]} +0x30=${buf2[cstr + 0x30]} +0x34=${buf2[cstr + 0x34]} +0x38=${buf2[cstr + 0x38]} +0x3C=${buf2[cstr + 0x3c]} +0x40=${buf2[cstr + 0x40]}`
      );
      console.log(`       postHash+0..40: ${ctx}`);
    }
  }
}

for (const f of files) {
  rec(null, f);
}

// Cross-check against descr_strat starting buildings for Salentinia/Uria.
console.log("\n--- descr_strat_buildings_large.json says Uria (region Salentinia) starts with: ---");
const ds = JSON.parse(
  fs.readFileSync("C:/dev/Provincia/public/descr_strat_buildings_large.json", "utf8")
);
let uriaEntry = null;
for (const fac of ds) {
  for (const s of fac.settlements || []) {
    if (s.region === "Salentinia") {
      uriaEntry = { faction: fac.faction, ...s };
      break;
    }
  }
  if (uriaEntry) break;
}
if (uriaEntry) {
  console.log(`  faction_creator: ${uriaEntry.faction}`);
  console.log(`  level: ${uriaEntry.level}  population: ${uriaEntry.population}`);
  for (const b of uriaEntry.buildings) {
    console.log(`  - ${b.type} -> ${b.level}`);
  }
} else {
  console.log("  (not found)");
}
