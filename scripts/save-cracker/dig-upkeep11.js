// dig-upkeep11.js — check if the 12 stride-354 records correspond to Romans Julii's armies
//
// Approach: compute (X, Y) of every Romans-Julii general/army in rome5 and see how many match.

const fs = require("fs");
const path = require("path");
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const cp = require("../../src/characterParser.js");
const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitNames = [];
for (const line of fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]);
}

const buf = fs.readFileSync(path.join(SAVES, "save_rome5..sav"));
const chars = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// The known 12 record coords in rome5:
const recCoords = [
  [292, 339], [246, 367], [289, 338], [257, 333], [302, 270], [227, 335],
  [260, 318], [69, 343], [259, 332], [75, 348], [79, 346], [87, 352]
];

// Show all character positions + their nearest matching record-coord
console.log("=== Characters with (X,Y) near one of the 12 record coords ===");
const chrXYHits = [];
for (const c of chars) {
  if (c.x == null || c.y == null) continue;
  for (let i = 0; i < recCoords.length; i++) {
    const [x, y] = recCoords[i];
    const dx = c.x - x, dy = c.y - y;
    if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
      chrXYHits.push({ rec: i, char: c, dx, dy });
    }
  }
}
console.log(`Total hits: ${chrXYHits.length}`);
for (const h of chrXYHits.slice(0, 50)) {
  const fn = h.char.firstName || '?';
  const ln = h.char.lastName || '';
  console.log(`  rec ${h.rec} (${recCoords[h.rec][0]},${recCoords[h.rec][1]}): char ${fn} ${ln} @ (${h.char.x},${h.char.y}) Δ(${h.dx},${h.dy}) role=${h.char.role}`);
}

// Roman Julii's typical X-range: 230-330 (Italian peninsula). 7 of the 12 records (rec 0,1,2,3,5,6,8)
// are in this range. The other 5 (rec 4 at 270, recs 7,9,10,11 at X=69-87) are far away.
//
// The (69-87, 343-352) cluster is in Sicily / North Africa - possibly Roman armies invading.
// Actually wait, that's X=69-87 which is far west - that's Iberia! Roman _Rebels_ might be there.
// Or are these the ENEMY armies the Romans are tracking?

// Let me also dump where all "roman general" strings are with their associated coords (read from
// adjacent bytes per land-unit layout)
console.log("\n=== \"roman general\" instances inside player record ===");
const playerStart = 0x154197a;
const playerEnd = 0x1578b5b;
let scanFrom = playerStart;
while (true) {
  const next = buf.indexOf(Buffer.from('roman general\0'), scanFrom);
  if (next === -1 || next > playerEnd) break;
  // Find the u16 length prefix - should be at next - 4 (01 00 0e 00)
  const m = next - 4;
  const a = buf[m], b = buf[m + 1], c = buf[m + 2], d = buf[m + 3];
  // After the string + null, units have: 01 [hash u32][region hash u32][...][region UTF-16LE]
  // Per dossier: nameLen u16 → ASCII name → 4 bytes (e.g. 01 + 24-bit hash?) → unit/seed u32 → small u32 → region UTF-16 with ff ff ff ff terminator → commanderUuid u32 → max u32 → soldiers u32 → ...
  // From earlier hex dump at +1463: "...l\0 01 07 24 38 01 17 45 13 e1 00 00 00 00 ee 02 00 00 09 00 00 00 15 00 R o m a n _ R e b e l s _ 1 _ R e g i o n ff ff ff ff 90 24 66 bf 15 ae 47 43 3c 00 00 00 3c 00 00 00"
  // So 0x3c 0x3c = 60, 60 = max, soldiers
  // Need to find the (ff ff ff ff) pattern after the UTF-16LE region name
  const strEnd = next + 'roman general\0'.length;
  // Walk forward until 4-byte 0xff terminator
  let p = strEnd;
  while (p + 4 < playerEnd) {
    if (buf[p] === 0xff && buf[p+1] === 0xff && buf[p+2] === 0xff && buf[p+3] === 0xff) {
      // commanderUuid right after
      const cu = buf.readInt32LE(p + 4);
      // Then 8 bytes I don't know, then max + soldiers
      // From the hex dump: ff ff ff ff 90 24 66 bf 15 ae 47 43 3c 00 00 00 3c 00 00 00
      // commanderUuid (4) + 8 unknown bytes + max u32 + soldiers u32 = 20 bytes after ff ff ff ff
      const max = buf.readUInt32LE(p + 4 + 12);
      const soldiers = buf.readUInt32LE(p + 4 + 16);
      const rel = m - playerStart;
      console.log(`  +${rel}: max=${max}, soldiers=${soldiers}, commanderUuid=0x${(cu >>> 0).toString(16)}`);
      break;
    }
    p++;
  }
  scanFrom = next + 1;
}

// Now look for "roman" cohort/legionary type units inside the player record
console.log("\n=== Searching for Roman-specific unit names in player record ===");
const romanUnits = ['hastati', 'principes', 'triarii', 'equites', 'velites', 'roman_cavalry', 'roman_cavalry'];
for (const u of romanUnits) {
  const tok = Buffer.from(u);
  let p = playerStart;
  let cnt = 0;
  while ((p = buf.indexOf(tok, p)) !== -1 && p < playerEnd) {
    cnt++;
    p++;
  }
  if (cnt > 0) console.log(`  ${u}: ${cnt} occurrences`);
}
