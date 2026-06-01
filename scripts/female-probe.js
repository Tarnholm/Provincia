// Follow married generals' spouseUuid to locate their wives' records and crack
// the female record layout. For each spouseUuid, find buffer occurrences and
// dump the name-index + gender byte found near each, to spot the pattern.
"use strict";
const fs = require("fs");
const x = require("../src/saveCrackerExtras.js");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_carthage3.sav";
const buf = fs.readFileSync(SAVE);
const lookup = fs.readFileSync("C:/RIS/RIS/data/descr_names_lookup.txt", "utf8").split(/\r?\n/).map(s => s.trim());
const validName = (i) => i > 1 && i < lookup.length && lookup[i] && lookup[i].length >= 3 && lookup[i][0] >= "A" && lookup[i][0] <= "Z";

const v2 = x.parseCharacterExtras(buf).filter(c => c.isMarried).slice(0, 8);
for (const g of v2) {
  const tgt = Buffer.alloc(4); tgt.writeUInt32LE(g.spouseUuid >>> 0, 0);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(tgt, p)) !== -1) { hits.push(p); p += 1; }
  console.log(`\nspouseUuid=${g.spouseUuid} ownUuid=${g.ownUuid} (${hits.length} hits)`);
  for (const h of hits) {
    // dump u32s and gender bytes in a window around the hit
    const parts = [];
    for (let off = -8; off <= 24; off += 4) {
      const o = h + off;
      if (o < 0 || o + 4 > buf.length) continue;
      const v = buf.readUInt32LE(o);
      const nm = validName(v) ? `=${lookup[v]}` : "";
      parts.push(`+${off}:${v}${nm}`);
    }
    console.log(`  @0x${h.toString(16)}: ${parts.join("  ")}`);
  }
}
