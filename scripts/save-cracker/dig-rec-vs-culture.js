// For each faction record, break down the char matches by CULTURE.
// Highest-culture-count identifies the faction's owner culture.
const fs = require("fs");
const { parseFactionTreasuries, parseCharacterExtras, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const buf = fs.readFileSync("C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_macedon t0.sav");

const treas = parseFactionTreasuries(buf);
const chars = parseCharacterExtras(buf);
const owners = identifyFactionRecordOwners(buf, treas);

// uuid → culture map
const uuidToCulture = new Map();
for (const c of chars) uuidToCulture.set(c.ownUuid, c.culture);

console.log("rec | banner-owner       | regions | treas | dominant-culture (chars-in-rec)");
console.log("----|--------------------|---------|-------|----------------------------------");
for (let i = 0; i < treas.length; i++) {
  const r = treas[i];
  const nextR = i + 1 < treas.length ? treas[i + 1] : null;
  const bodySpan = nextR ? nextR.offset - r.offset : Math.min(buf.length - r.offset, 200000);
  const cultureCounts = {};
  for (let off = 0; off + 4 < bodySpan; off += 1) {
    const v = (buf[r.offset + off] | (buf[r.offset + off + 1] << 8) | (buf[r.offset + off + 2] << 16) | (buf[r.offset + off + 3] << 24)) >>> 0;
    const culture = uuidToCulture.get(v);
    if (culture) {
      cultureCounts[culture] = (cultureCounts[culture] || 0) + 1;
    }
  }
  // Dedup by counting unique UUIDs per culture
  const uniqueByCulture = {};
  const seen = new Set();
  for (let off = 0; off + 4 < bodySpan; off += 1) {
    const v = (buf[r.offset + off] | (buf[r.offset + off + 1] << 8) | (buf[r.offset + off + 2] << 16) | (buf[r.offset + off + 3] << 24)) >>> 0;
    const culture = uuidToCulture.get(v);
    if (culture && !seen.has(v)) {
      seen.add(v);
      uniqueByCulture[culture] = (uniqueByCulture[culture] || 0) + 1;
    }
  }
  const top = Object.entries(uniqueByCulture).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const banner = owners[i].factionName || "(unknown)";
  const topStr = top.map(([c, n]) => `${c}:${n}`).join(", ");
  console.log(`${i.toString().padStart(2)}  | ${banner.padEnd(18)} | ${r.regionCount.toString().padStart(3)}r    | ${r.treasury.toString().padStart(5)} | ${topStr}`);
}
