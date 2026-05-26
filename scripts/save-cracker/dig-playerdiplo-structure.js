// Examine the structure of the player record region. Look for:
//  - A class-100-like signature (or different class enum) for the player
//  - The player's diplomacy marker zone (0x39240005)
//  - Region records / region count to bound the player record
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};

// Find all class-100-like records but with ANY class value (relax class==100).
function findAllFactionLikeRecords(buf, maxOff) {
  const out = [];
  for (let i = 0; i + 96 < maxOff; i += 1) {
    // version==1 at +12, self ptrs at +24 and +40, +44==6
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const cls = buf.readUInt32LE(i + 8);
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 250) continue;
    out.push({ offset: i, cls, regions });
  }
  return out;
}

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  const firstMajor = recs[0].offset;
  console.log(`\n===== ${label} (${player}) firstMajor=0x${firstMajor.toString(16)} =====`);

  // Look for ANY faction-like record BEFORE firstMajor (with any class value).
  const before = findAllFactionLikeRecords(buf, firstMajor);
  console.log(`faction-like records (any class) before firstMajor: ${before.length}`);
  for (const r of before.slice(-15)) {
    console.log(`  0x${r.offset.toString(16)} class=${r.cls} regions=${r.regions}`);
  }

  // Where's the LAST one before firstMajor? That might be the player record.
  // Also count diplomacy markers before firstMajor.
  const MARKER = 0x39240005;
  const markers = [];
  for (let i = 0; i + 8 < firstMajor; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const cnt = buf.readUInt32LE(i + 4);
    if (cnt > 0 && cnt <= 250) markers.push({ off: i, count: cnt });
  }
  console.log(`diplomacy markers (0x39240005) before firstMajor: ${markers.length}`);
  for (const m of markers) console.log(`  0x${m.off.toString(16)} count=${m.count}`);
}
