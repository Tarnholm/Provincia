// dig-settle-candidates.js — list ALL name occurrences with their stats-block
// field reads + score, so we can see which occurrence is the real record.
// Usage: node dig-settle-candidates.js "<save>" <name>
"use strict";
const { loadSave, nameOccurrences, scoreCandidate } = require("./dig-settle-lib");
const buf = loadSave(process.argv[2]);
const name = process.argv[3];
const occ = nameOccurrences(buf, name);
console.log(`name "${name}": ${occ.length} occurrence(s)`);
for (const np of occ) {
  if (np - 583 < 0 || np + 4 > buf.length) { console.log(`  np=${np}: out of range`); continue; }
  const u32 = (dx) => buf.readUInt32LE(np + dx);
  const sc = scoreCandidate(buf, np);
  console.log(`  np=${np} score=${sc} creator(-583)=${buf[np-583]} lvl(-571)=${u32(-571)} tax(-562)=${buf[np-562]} PO(-435)=${u32(-435)} income(-127)=${u32(-127)} pop(-35)=${u32(-35)} popCopy(-223)=${u32(-223)}`);
}
