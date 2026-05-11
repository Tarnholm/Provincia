// dig-faction-treasury-final.js — session 5
//
// CONFIRMED finding: per-faction current treasury (denarii) lives at offset
// +0 of the major-faction record. The record has a structural signature:
//   +8  u32 == 100       (MAJOR-CLASS tag — only 23 records match in any save)
//   +12 u32 == 1         (version)
//   +24 self-pointer
//   +40 self-pointer
//   +44 u32 == 6         (size of next sub-section)
//   +48 u32              (regionCount N)
//   +52..+(52+4N)        (region IDs)
//   +(92 + 4N)           (start-of-turn treasury snapshot)
//
// First record (index 0) is always the player faction. Remaining records
// follow descr_strat major-faction order with the player slot removed.
//
// Usage: node dig-faction-treasury-final.js <save-path>
const fs = require("fs");
const path = require("path");

function readFactionRecords(buf) {
  const out = [];
  for (let i = 0; i + 64 < buf.length; i += 1) {
    if (buf.readUInt32LE(i + 8) !== 100) continue;
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 16) !== 0 || buf.readUInt32LE(i + 20) !== 0) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 32) !== 0 || buf.readUInt32LE(i + 36) !== 0) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 200) continue;
    const treasury = buf.readInt32LE(i);
    const turnStart = buf.readInt32LE(i + 92 + 4 * regions);
    // Region IDs
    const regionIds = [];
    for (let r = 0; r < regions; r += 1) {
      regionIds.push(buf.readUInt32LE(i + 52 + r * 4));
    }
    out.push({ pos: i, treasury, turnStart, regionCount: regions, regionIds });
  }
  return out;
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node dig-faction-treasury-final.js <save-path>");
    process.exit(1);
  }
  const buf = fs.readFileSync(filePath);
  console.log("File:", path.basename(filePath), buf.length, "bytes");
  const recs = readFactionRecords(buf);
  console.log("\n23 major faction records (player at index 0):");
  console.log("idx | pos        | treasury  | turnStart | net  | regions | first 5 region IDs");
  for (let i = 0; i < recs.length; i += 1) {
    const r = recs[i];
    const net = r.treasury - r.turnStart;
    console.log(
      `  ${i.toString().padStart(2)} | 0x${r.pos.toString(16).padStart(8, "0")} | ${r.treasury.toString().padStart(8)} | ${r.turnStart.toString().padStart(8)} | ${net.toString().padStart(5)} | ${r.regionCount.toString().padStart(3).padStart(7)} | ${r.regionIds.slice(0, 5).join(", ")}`,
    );
  }
}

main();
