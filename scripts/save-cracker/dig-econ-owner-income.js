// dig-econ-owner-income.js
// Group settlements by owner-UUID (marker-1944) and sum per-turn income
// (marker-1586). Identify the player's group (antigonid owns 22 regions =>
// expect ~22 settlements). The player's TOTAL settlement income is then a known
// gross value to anchor the FACTION_ECONOMICS search.
const fs = require("fs");
const path = require("path");
const { findAllSettlementMarkers } = require("C:/dev/Provincia/src/buildingParser.js");
const BASE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const FILES = { T1: "save_arretium pre retrained..sav", T2: "save_arretium retrained turn 2.sav", T3: "save_arretium turn 3.sav", T4: "save_arretium turn 4.sav" };

for (const [t, f] of Object.entries(FILES)) {
  const buf = fs.readFileSync(path.join(BASE, f));
  const setts = findAllSettlementMarkers(buf);
  const byOwner = new Map();
  for (const s of setts) {
    const ownerOff = s.offset - 1944, incOff = s.offset - 1586;
    if (ownerOff < 0 || incOff < 0) continue;
    const owner = buf.readUInt32LE(ownerOff);
    const inc = buf.readUInt32LE(incOff);
    if (inc > 50000) continue; // sanity
    if (!byOwner.has(owner)) byOwner.set(owner, { count: 0, inc: 0, cities: [] });
    const g = byOwner.get(owner); g.count++; g.inc += inc; g.cities.push(`${s.name}:${inc}`);
  }
  console.log(`\n===== [${t}] ${f} — ${setts.length} settlement markers =====`);
  const rows = [...byOwner.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [owner, g] of rows.slice(0, 10)) {
    console.log(`  owner=0x${owner.toString(16).padStart(8,"0")} count=${String(g.count).padStart(3)} totalInc=${String(g.inc).padStart(6)}  ${g.cities.slice(0,4).join(" ")}`);
  }
  // The group with ~22 cities including Rome/Arretium is the player.
  const player = rows.find(([o, g]) => g.cities.some(c => c.startsWith("Rome:") || c.startsWith("Arretium:")));
  if (player) {
    console.log(`  >>> PLAYER group owner=0x${player[0].toString(16)} cities=${player[1].count} TOTAL GROSS settlement income=${player[1].inc}`);
    console.log(`      cities: ${player[1].cities.join(" ")}`);
  }
}
