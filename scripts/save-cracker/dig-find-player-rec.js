// For each unidentified record (no captain banner), count how many of
// our 143 char UUIDs appear in the FULL record body. The record with
// the most char matches is the most likely candidate for the player
// (since players have the most generals).

const fs = require("fs");
const { parseFactionTreasuries, parseCharacterExtras, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const treas = parseFactionTreasuries(buf);
const chars = parseCharacterExtras(buf);
const ownUuidSet = new Set(chars.map(c => c.ownUuid));
const owners = identifyFactionRecordOwners(buf, treas);

console.log("scanning record bodies for char UUID matches...");
console.log("rec_idx (owner) regions treasury bodyspan → char_matches");

for (let i = 0; i < treas.length; i++) {
  const r = treas[i];
  const nextR = i + 1 < treas.length ? treas[i + 1] : null;
  const bodySpan = nextR ? nextR.offset - r.offset : Math.min(buf.length - r.offset, 500000);
  // Build a set of all u32 values that fall in ownUuidSet
  const matches = new Set();
  for (let off = 0; off + 4 < bodySpan; off += 1) {
    const v = buf[r.offset + off] | (buf[r.offset + off + 1] << 8) | (buf[r.offset + off + 2] << 16) | (buf[r.offset + off + 3] << 24);
    if (ownUuidSet.has(v >>> 0)) matches.add(v >>> 0);
  }
  const owner = owners[i].factionName || "(unknown)";
  console.log(`rec ${i.toString().padStart(2)} ${owner.padEnd(20)} ${r.regionCount.toString().padStart(3)}r ${r.treasury.toString().padStart(6)}t span=${bodySpan.toString().padStart(7)}: ${matches.size} unique char matches`);
}
