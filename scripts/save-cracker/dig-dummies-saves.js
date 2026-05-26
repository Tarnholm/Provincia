// Inspect the two Dummies saves (late campaign) for item/character/unit
// counts and registry quantities. Looking for engine-limit signals.
const fs = require("fs");
const path = require("path");
const { parseCharacterExtras } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = [
  "C:\\Users\\vtarn\\Downloads\\save_Autosave   Dummies   Turn 900 End.sav",
  "C:\\Users\\vtarn\\Downloads\\save_Autosave   Dummies   Turn 1134.sav",
];

function readRegistry(buf) {
  let p = 0x100;
  while (p < 0x10000) {
    const count = buf.readUInt32LE(p);
    if (count > 0 && count < 100000) {
      const nameStart = p + 4;
      if (buf[nameStart] >= 0x41 && buf[nameStart] <= 0x5a) {
        const end = buf.indexOf(0x00, nameStart);
        if (end !== -1 && end > nameStart && end < nameStart + 60) {
          const name = buf.slice(nameStart, end).toString("latin1");
          if (/^[A-Z][A-Z_0-9]*$/.test(name)) break;
        }
      }
    }
    p++;
  }
  const types = [];
  while (true) {
    const count = buf.readUInt32LE(p);
    const nameStart = p + 4;
    const end = buf.indexOf(0x00, nameStart);
    if (end === -1 || end > nameStart + 60) break;
    const name = buf.slice(nameStart, end).toString("latin1");
    if (!/^[A-Z][A-Z_0-9]*$/.test(name)) break;
    types.push({ id: types.length, offset: p, name, count });
    p = end + 1;
  }
  return { types, registryStart: 0x3310, registryEnd: p };
}

for (const sp of SAVES) {
  const buf = fs.readFileSync(sp);
  const fn = path.basename(sp);
  console.log(`\n=== ${fn} ===`);
  console.log(`size: ${buf.length.toLocaleString()} bytes (${(buf.length/1024/1024).toFixed(1)} MB)`);

  const { types } = readRegistry(buf);
  console.log(`section types: ${types.length}`);

  // Headline counts
  const interesting = ["WORLD_MAP", "FACTION", "FACTION_ECONOMICS", "CHARACTER", "CHARACTER_DB", "CHARACTER_RECORD", "ANCILLARY_UNIT", "SOLDIER_PERSISTENT", "UNIT", "ARMY", "FORT", "SETTLEMENT", "SETTLEMENT_MANAGER", "WATCHTOWER", "PORT", "SIEGE", "BUILDING", "BUILDING_CONSTRUCTION_ITEM", "EVENT_MANAGER", "JOURNAL_EVENT", "SENATE_EVENT", "MISSION_HISTORY_ENTRY", "MERCENARY_DESCRIPTION", "POSITION", "OFFICE", "LEGION_DESCRIPTION"];
  for (const name of interesting) {
    const t = types.find(x => x.name === name);
    if (t) console.log(`  ${name.padEnd(28)} count = ${t.count}`);
  }

  // Character count via parseCharacterExtras (role-string anchor)
  try {
    const chars = parseCharacterExtras(buf);
    console.log(`role-anchored chars (parseCharacterExtras): ${chars.length}`);
  } catch (e) {
    console.log(`parseCharacterExtras failed: ${e.message}`);
  }

  // Count `captain_card_` paths — proxy for total captains in save
  const ccTarget = Buffer.from("captain_card_", "ascii");
  let captainCardCount = 0;
  let p = 0;
  while ((p = buf.indexOf(ccTarget, p)) !== -1) { captainCardCount++; p += 1; }
  console.log(`captain_card_*.tga path occurrences: ${captainCardCount}`);

  // Look for any "limit" / "max" patterns near the end
  const tail = buf.slice(buf.length - 0x100);
  const tailHasZeros = Array.from(tail).every(b => b === 0);
  console.log(`tail (last 256 bytes) all-zero? ${tailHasZeros}`);
}
