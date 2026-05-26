// Locate the player faction record and its bounds. It sits BEFORE
// factionRecords[0].offset (the first NPC class-100 major record).
const fs = require("fs");
const {
  parseFactionTreasuries,
  identifyPlayerFactionFromSave,
} = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  seleucid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_Seleucids t0.sav",
  antigonid: "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav",
};

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const player = identifyPlayerFactionFromSave(buf, recs);
  const firstMajor = recs[0].offset;
  console.log(`\n===== ${label} (${player}) save size=${buf.length} (0x${buf.length.toString(16)}) =====`);
  console.log(`first NPC major record offset = 0x${firstMajor.toString(16)} (${firstMajor})`);
  console.log(`23 NPC records: ${recs.map(r => `0x${r.offset.toString(16)}`).join(" ")}`);

  // Find all captain_card_<player>.tga occurrences before firstMajor (player banner)
  const target = Buffer.from("captain_card_" + player, "ascii");
  const bannerOffsets = [];
  let p = 0;
  while ((p = buf.indexOf(target, p)) !== -1) {
    bannerOffsets.push(p);
    p += 1;
  }
  const before = bannerOffsets.filter(o => o < firstMajor);
  console.log(`captain_card_${player} total=${bannerOffsets.length}, before firstMajor=${before.length}`);
  console.log(`  first few before-banner offsets: ${before.slice(0, 10).map(o => `0x${o.toString(16)}`).join(" ")}`);

  // Search for the player faction internal name as a raw ASCII string everywhere
  // before firstMajor to see if there's a player record header.
  const nameBytes = Buffer.from(player, "ascii");
  let np = 0; const nameHits = [];
  while ((np = buf.indexOf(nameBytes, np)) !== -1) {
    if (np >= firstMajor) break;
    // Only count if surrounded by non-alpha (whole token) or null-terminated
    nameHits.push(np);
    np += 1;
  }
  console.log(`player-name ASCII hits before firstMajor: ${nameHits.length}`);
  console.log(`  first 20: ${nameHits.slice(0,20).map(o=>`0x${o.toString(16)}`).join(" ")}`);
}
