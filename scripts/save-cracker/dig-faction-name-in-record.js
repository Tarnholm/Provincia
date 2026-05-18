// Each faction record contains its internal name (e.g. "romans_julii")
// as ASCII inside the body. Scan each record's body for any of the
// known faction names from lua counters; this gives record_index →
// faction_name mapping, unblocking proper player identification.

const fs = require("fs");
const { parseFactionTreasuries } = require("C:/dev/Provincia/src/saveCrackerExtras.js");
const { findLuaCounters } = require("C:/dev/Provincia/src/luaCounterParser.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const counters = findLuaCounters(buf);
const factionNames = counters
  .filter(c => /^id_/.test(c.name))
  .map(c => c.name.slice(3)) // strip "id_"
  .sort((a, b) => b.length - a.length); // longest first (avoid substring matches)

console.log(`scanning for ${factionNames.length} known faction names...`);

const treas = parseFactionTreasuries(buf);
console.log(`${treas.length} faction records`);

console.log("\nrec → faction name mapping:");
for (let i = 0; i < treas.length; i++) {
  const r = treas[i];
  const nextR = i + 1 < treas.length ? treas[i + 1] : null;
  const span = nextR ? nextR.offset - r.offset : 200000;
  // Try each faction name as ASCII in the record body
  const found = [];
  const slice = buf.slice(r.offset, r.offset + span);
  for (const name of factionNames) {
    const ascii = Buffer.from(name, "ascii");
    if (slice.indexOf(ascii) >= 0) {
      // Find ALL positions in this slice
      const positions = [];
      let p = 0;
      while ((p = slice.indexOf(ascii, p)) !== -1) { positions.push(p); p += ascii.length; }
      found.push({ name, count: positions.length, firstPos: positions[0] });
    }
  }
  // Sort by firstPos (earliest occurrence = most likely the faction's own name)
  found.sort((a, b) => a.firstPos - b.firstPos);
  const top = found.slice(0, 3);
  console.log(`rec ${i.toString().padStart(2)} @0x${r.offset.toString(16)} (${r.treasury}, ${r.regionCount} regions): ${top.map(f => `${f.name}(×${f.count}@+${f.firstPos})`).join(", ")}`);
}
