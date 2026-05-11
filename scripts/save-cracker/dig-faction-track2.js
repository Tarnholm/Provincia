// dig-faction-track2.js — session 5
// Get all 23 faction records from rome1 in order, and from rome7 (turn boundary).
const fs = require("fs");
const path = require("path");

function findFactionRecords(buf) {
  const hits = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regionCount = buf.readUInt32LE(i + 48);
    if (regionCount > 200) continue;
    const treasury = buf.readUInt32LE(i);
    const runtime = buf.readUInt32LE(i + 4);
    // Read region IDs
    const regions = [];
    for (let r = 0; r < regionCount; r += 1) {
      regions.push(buf.readUInt32LE(i + 52 + r * 4));
    }
    hits.push({ pos: i, treasury, runtime, regionCount, regions });
  }
  return hits;
}

function main() {
  const dir = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
  const filesToShow = [
    "save_rome1.sav",
    "save_rome5..sav",
    "save_rome6.sav",
    "save_rome7.sav",
    "save_rome10.sav",
  ];
  for (const f of filesToShow) {
    const buf = fs.readFileSync(path.join(dir, f));
    const hits = findFactionRecords(buf);
    console.log(`\n## ${f} (${hits.length} factions)`);
    for (let i = 0; i < hits.length; i += 1) {
      const h = hits[i];
      const tres = h.treasury > 2 ** 31 ? h.treasury - 2 ** 32 : h.treasury;
      console.log(`  [${i.toString().padStart(2)}] pos=0x${h.pos.toString(16).padStart(8, "0")} treasury=${tres.toString().padStart(8)} regions=${h.regionCount.toString().padStart(3)} runtime=0x${h.runtime.toString(16).padStart(8, "0")}`);
    }
  }

  // Cross-check: compare rome1 region IDs of record [0] (Romans Julii?) with descr_strat assignments.
  // Also: rome1 has Romans Julii at index 0. The dossier says Sparta has faction-id 30 in a Sparta save.
  // Let's read FIRST faction's region list and check.
  const rome1 = fs.readFileSync(path.join(dir, "save_rome1.sav"));
  const hits = findFactionRecords(rome1);
  console.log("\n## rome1 first faction region list (expected Romans Julii):");
  console.log(hits[0].regions.slice(0, 35).join(", "));
}

main();
