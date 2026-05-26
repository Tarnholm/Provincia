// dig-religion-find-statsblock.js
// Find ALL occurrences of a settlement name as UTF-16 in the save, and for each,
// test whether it sits at the END of a 583-byte stats block (creator@-583,
// level@-571, PO@-435, income@-127, population@-35 per memory
// reference_settlement_stats_block). Then dump bytes around the stats block to
// hunt for the religion (belief-index / percent) data.
const fs = require("fs");
const SAVE = process.argv[3] || "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav";
const NAME = process.argv[2] || "Pella";
const buf = fs.readFileSync(SAVE);
console.log("save:", SAVE.split("\\").pop(), "size:", buf.length, "name:", NAME);

// UTF-16LE bytes of the name (no markers — just the chars)
const u16 = [];
for (const ch of NAME) { u16.push(ch.charCodeAt(0)); u16.push(0); }
const pat = Buffer.from(u16);

const hits = [];
let p = 0;
while ((p = buf.indexOf(pat, p)) !== -1) { hits.push(p); p += 1; }
console.log("total UTF-16 occurrences:", hits.length);

for (const nameStart of hits) {
  // nameStart = first byte of UTF-16 name. Stats block ends here (name is last field).
  const np = nameStart;
  const get32 = (rel) => (np + rel >= 0 && np + rel + 4 <= buf.length) ? buf.readUInt32LE(np + rel) : -1;
  const creatorRaw = get32(-583); // creator faction id (small)
  const level = get32(-571);
  const po = buf[np - 435];
  const income = get32(-127);
  const pop = get32(-35);
  const plausible = (level >= 0 && level <= 6) && (pop > 50 && pop < 200000);
  console.log("\n--- occ @0x" + nameStart.toString(16) + " creator@-583=" + creatorRaw +
    " level@-571=" + level + " PO@-435=" + po + " income@-127=" + income + " pop@-35=" + pop +
    (plausible ? "  [PLAUSIBLE STATS BLOCK]" : ""));
}
