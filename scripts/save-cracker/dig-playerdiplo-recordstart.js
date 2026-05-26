// Find the player record START by walking backward from the diplo-marker
// header (the self-ptr at markerOff-... with 239 + faction_id). The 23 NPC
// records start with [i32 treasury][...][u32 100][u32 1]. The player record
// likely has the SAME prefix but a DIFFERENT class value (not 100).
// Search backward for a class-record signature: version==1 @+12, self ptrs.
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};
const MARKER = 0x39240005;

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  const firstMajor = recs[0].offset;
  const playerIdx = label === "seleucid" ? 7 : 5;
  let markerOff = -1;
  for (let i = 0; i + 8 < firstMajor; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const cnt = buf.readUInt32LE(i + 4);
    if (cnt > 0 && cnt <= 250) { markerOff = i; break; }
  }
  console.log(`\n===== ${label} (${player}, idx=${playerIdx}) markerOff=0x${markerOff.toString(16)} =====`);

  // Find class-record-like prefixes backward (version=1@+12, self@+24, self@+40, 6@+44)
  // relaxing class to anything.
  let recStart = -1;
  for (let i = markerOff; i > markerOff - 600000 && i > 0; i--) {
    if (buf.readUInt32LE(i + 12) !== 1) continue;
    if (buf.readUInt32LE(i + 24) !== i + 24) continue;
    if (buf.readUInt32LE(i + 40) !== i + 40) continue;
    if (buf.readUInt32LE(i + 44) !== 6) continue;
    const regions = buf.readUInt32LE(i + 48);
    if (regions > 250) continue;
    const cls = buf.readUInt32LE(i + 8);
    console.log(`  class-record-like @0x${i.toString(16)} class=${cls} regions=${regions} treasury=${buf.readInt32LE(i)} distToMarker=${markerOff-i}`);
    if (recStart < 0) recStart = i;
  }

  // Also: how many u32 == playerIdx appear in [markerOff-200000, markerOff]?
  let cntPlayerIdx = 0;
  const tgt = Buffer.alloc(4); tgt.writeUInt32LE(playerIdx);
  let p = Math.max(0, markerOff - 300000);
  const limit = markerOff;
  const idxOffsets = [];
  while (p < limit) {
    const v = buf.readUInt32LE(p);
    if (v === playerIdx) { cntPlayerIdx++; if (idxOffsets.length < 30) idxOffsets.push(p); }
    p += 4;
  }
  console.log(`  u32==playerIdx(${playerIdx}) aligned hits in 300KB before marker: ${cntPlayerIdx}`);
}
