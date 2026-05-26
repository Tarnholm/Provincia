// dig-trade-settlement-income.js
// Verify the per-settlement income field (memory: name-127 u32) and search the
// settlement stats block for a TRADE-specific income sub-component.
// Ground truth (Spain T1 vanilla, from reference_settlement_stats_block):
//   Corduba income=1144, Numantia=440, Asturica=264, Scallabis=352, Osca=528
"use strict";
const fs = require("fs");
const { findAllSettlementMarkers } = require("../../src/buildingParser.js");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_17-05-2026   Spain   Turn 1.sav";
const buf = fs.readFileSync(SAVE);

const GT = { Corduba: 1144, Numantia: 440, Asturica: 264, Scallabis: 352, Osca: 528 };

// Settlement markers; name pos = marker.offset + 3 (after flag,nchars,0x00)
const marks = findAllSettlementMarkers(buf);
const wanted = marks.filter(m => GT[m.name]);
console.log("found settlement markers for GT cities:", wanted.map(m => m.name).join(", "));

for (const m of wanted) {
  const namePos = m.offset; // marker.offset is the flag byte; UTF-16 name at +3
  // memory uses "settlement-name UTF-16 position" = namePos+3
  const np = m.offset + 3;
  const incomeOff = np - 127;
  const income = buf.readUInt32LE(incomeOff);
  console.log(`\n${m.name}: name@0x${np.toString(16)} income@-127=${income} (GT=${GT[m.name]}) match=${income === GT[m.name]}`);
  // If mismatch, scan the whole stats block (np-583 .. np) for the GT value
  if (income !== GT[m.name]) {
    for (let dx = -600; dx < 0; dx++) {
      if (np + dx < 0 || np + dx + 4 > buf.length) continue;
      if (buf.readUInt32LE(np + dx) === GT[m.name]) console.log(`   GT value ${GT[m.name]} found at dx=${dx}`);
    }
  }
}

// Now: dump the full stats block for one settlement (Corduba) to look for
// component fields (trade vs farm vs tax). Show u32 stream with dx labels.
const corduba = wanted.find(m => m.name === "Corduba");
if (corduba) {
  const np = corduba.offset + 3;
  console.log("\n=== Corduba stats block u32 dump (dx from name) ===");
  const row = [];
  for (let dx = -583; dx <= -4; dx += 4) {
    const v = buf.readUInt32LE(np + dx);
    if (v !== 0 && v < 100000) row.push(`${dx}=${v}`);
  }
  console.log(row.join("  "));
}
