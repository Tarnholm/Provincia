// dig-chain-tiers.js — count chain occurrences AND their tier levels.
// Per CRACKER-SUMMARY: each building has byte+4 = tier (0-4).
"use strict";
const fs = require("fs");
const path = require("path");
const { findAllSettlementMarkers, scanChainsBetween } = require(path.resolve("src/buildingParser.js"));

const SAVES = [
  ["t900-end",       "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 900 End.sav"],
  ["t960-start",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

for (const [tag, path] of SAVES) {
  const buf = fs.readFileSync(path);
  console.log(`\n=== ${tag} ===`);
  const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= 0xf85f00 && s.offset < 0x1f10c72);
  console.log(`settlements: ${setts.length}`);

  const counts = { port_buildings: 0, river_port: 0, hinterland_roads: 0 };
  const levelTally = { port_buildings: {}, river_port: {}, hinterland_roads: {} };
  // Per CRACKER-SUMMARY: each chain record's `level` (byte+4 of the data
  // after the name+null) is the tier (0-based).
  // port_buildings has 3 tiers: 0=port, 1=shipwright, 2=dockyard
  // river_port: 0=river_port1, 1=river_port2
  // hinterland_roads: 0=path/dirt, 1=road, 2=highway... (per EDB)
  for (let i = 0; i < setts.length; i++) {
    const prevEnd = i === 0 ? 0xf85f00 : setts[i-1].blockEnd;
    const chains = scanChainsBetween(buf, prevEnd, setts[i].offset, null, null);
    for (const c of chains) {
      if (c.name in counts) {
        counts[c.name]++;
        const lvl = c.level;
        levelTally[c.name][lvl] = (levelTally[c.name][lvl] || 0) + 1;
      }
    }
  }
  console.log("chain counts:");
  for (const [n, c] of Object.entries(counts)) console.log(`  ${n}: ${c}`);
  console.log("level tallies (level = tier 0..N):");
  for (const [n, t] of Object.entries(levelTally)) {
    if (Object.keys(t).length === 0) continue;
    const sum = Object.entries(t).map(([k,v]) => `t${k}=${v}`).join(" ");
    const lvlSum = Object.entries(t).reduce((acc, [k,v]) => acc + parseInt(k)*v, 0);
    const totalIncludingFreeTier0 = Object.values(t).reduce((a,b)=>a+b,0);
    // Total "items" counting each tier separately = sum of (tier+1) × count (because tier 2 implies tiers 0+1+2 were built)
    const itemsTotal = Object.entries(t).reduce((acc, [k,v]) => acc + (parseInt(k)+1)*v, 0);
    console.log(`  ${n}: ${sum}   total-built(t+1 sum)=${itemsTotal}`);
  }
}
