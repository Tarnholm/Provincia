// The captain_card_antigonid.tga path at 0x150c1d9 should be inside the
// player faction's record. Find a self-pointer pattern that encloses it.
const fs = require("fs");
const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const ANCHOR = 0x150c1d9; // captain_card_antigonid.tga

// Walk backwards from ANCHOR looking for any self-pointer
console.log("Self-pointers in 256 KB before anchor:");
const selfPtrs = [];
for (let p = Math.max(0, ANCHOR - 0x40000); p < ANCHOR; p++) {
  if (p + 4 > buf.length) break;
  if (buf.readUInt32LE(p) === p) {
    selfPtrs.push(p);
  }
}
console.log(`${selfPtrs.length} self-pointers found. Last 20:`);
for (const sp of selfPtrs.slice(-20)) {
  const next4 = buf.readUInt32LE(sp + 4);
  console.log(`  0x${sp.toString(16)}  +4=0x${next4.toString(16).padStart(8,'0')}  delta_to_anchor=${(ANCHOR - sp).toLocaleString()}`);
}

// Find ALL captain_card_X.tga paths in the WHOLE save, grouped by faction
console.log("\n=== ALL captain_card_X.tga locations in save ===");
const target = Buffer.from("captain_card_", "ascii");
const banners = []; // [{ at, faction }]
let p = 0;
while ((p = buf.indexOf(target, p)) !== -1) {
  let end = p + target.length;
  while (end < p + 80 && buf[end] !== 0x2e && buf[end] >= 0x20 && buf[end] < 0x7f) end++;
  const name = buf.slice(p + target.length, end).toString("ascii");
  banners.push({ at: p, faction: name });
  p = end;
}
console.log(`${banners.length} total captain banner paths`);
const byFaction = new Map();
for (const b of banners) {
  if (!byFaction.has(b.faction)) byFaction.set(b.faction, []);
  byFaction.get(b.faction).push(b.at);
}
console.log("Unique factions: " + byFaction.size);
console.log("\nfirst occurrence of each faction (sorted by offset):");
const firstOccs = Array.from(byFaction.entries()).map(([k, vs]) => ({ faction: k, first: vs[0], count: vs.length }));
firstOccs.sort((a, b) => a.first - b.first);
for (const f of firstOccs.slice(0, 40)) {
  console.log(`  0x${f.first.toString(16).padStart(8,'0')}  ${f.faction.padEnd(20)}  ${f.count}x`);
}

// The FIRST captain_card_X.tga before any of the 23 major-faction records
// (starting at 0x1538dd8) is likely in the player's section
console.log("\n=== first occurrence BEFORE 0x1538dd8 (= first NPC major rec) ===");
for (const f of firstOccs.filter(x => x.first < 0x1538dd8)) {
  console.log(`  0x${f.first.toString(16)}  ${f.faction.padEnd(20)}  ${f.count}x`);
}
