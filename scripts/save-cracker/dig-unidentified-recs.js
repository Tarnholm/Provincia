// Look INSIDE the 13 unidentified faction records (no captain banners).
// Search for ANY ASCII faction-name-like strings to identify them.
const fs = require("fs");
const { parseFactionTreasuries, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");
const treas = parseFactionTreasuries(buf);
const owners = identifyFactionRecordOwners(buf, treas);

// Find unidentified records
const unidentified = [];
for (let i = 0; i < owners.length; i++) {
  if (!owners[i].factionName) {
    const r = treas[i];
    const nextR = i + 1 < treas.length ? treas[i + 1] : null;
    const span = nextR ? nextR.offset - r.offset : Math.min(buf.length - r.offset, 200000);
    unidentified.push({ idx: i, offset: r.offset, span, regionCount: r.regionCount, treasury: r.treasury });
  }
}
console.log(`${unidentified.length} unidentified records`);

// For each, find ALL `_card_FACTIONNAME.tga` patterns (not just captain_card_)
// AND other distinctive ASCII patterns
const CARD_PATTERNS = [
  /captain_card_(\w+)\.tga/g,
  /captain_portrait_(\w+)\.tga/g,
  /general_card_(\w+)\.tga/g,
  /unit_card_(\w+)\.tga/g,
  /faction_(\w+)/g,
  /symbols\/(\w+)\.tga/g,
  /symbol_(\w+)\.tga/g,
];

for (const u of unidentified.slice(0, 13)) {
  console.log(`\n--- rec ${u.idx} @ 0x${u.offset.toString(16)} regions=${u.regionCount} treasury=${u.treasury} span=${u.span} ---`);
  const region = buf.slice(u.offset, u.offset + u.span);
  const regionText = region.toString("latin1");
  // Find every alpha-only ASCII run >=6 chars
  const stringMatches = regionText.match(/[a-z_][a-z_0-9]{5,30}/g) || [];
  const counts = new Map();
  for (const s of stringMatches) {
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  // Filter to entries containing "card" or "portrait" or "faction" or "symbol"
  const factionish = [];
  for (const [s, c] of counts.entries()) {
    if (s.includes("card") || s.includes("portrait") || s.includes("faction") || s.includes("symbol") || s.includes("banner")) {
      factionish.push([s, c]);
    }
  }
  factionish.sort((a, b) => b[1] - a[1]);
  console.log(`  faction-related strings (top 5):`);
  for (const [s, c] of factionish.slice(0, 5)) {
    console.log(`    ${s.padEnd(40)} x${c}`);
  }
}
