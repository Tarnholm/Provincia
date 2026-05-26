// dig-diplocat-reputation.js
// Target #3: faction reputation / global standing (Reliable..Untrustworthy).
// The faction record's "midblock" (from +92+4N to the diplo zone at +244+4N)
// is ~152 bytes and holds factionId(+99) & ai_personality(+135). Dump the
// whole midblock for all 23 records to look for a per-faction reputation int/
// float/byte. RTW reputation is a faction-global value, so it should appear
// once per faction record and vary across factions.
const fs = require("fs");
const { parseFactionTreasuries, identifyFactionRecordOwners } = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVES = {
  "macedon t0 (RIS)":   "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
  "Seleucids t0 (RIS)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
};
const SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8");
  const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
const order = loadFactionOrder(SM_FACTIONS);

for (const [label, path] of Object.entries(SAVES)) {
  const buf = fs.readFileSync(path);
  const recs = parseFactionTreasuries(buf);
  const owners = identifyFactionRecordOwners(buf, recs, order);
  console.log(`\n############ ${label} ############`);
  // For each record, dump the midblock relative bytes 0..152 (after region IDs).
  // midBase = offset + 92 + 4N.  factionId at +99, ai_personality at +135.
  // We'll print each byte column across all factions to find columns that VARY
  // meaningfully (candidate reputation).
  const rows = [];
  const MID_LEN = 152;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const midBase = r.offset + 92 + 4 * r.regionCount;
    const bytes = [];
    for (let k = 0; k < MID_LEN; k++) bytes.push(buf[midBase + k]);
    rows.push({ name: owners[i].factionName, bytes });
  }
  // Find columns that vary across factions (excluding the all-zero or constant ones)
  console.log("varying byte columns in midblock (offset relative to midBase):");
  for (let col = 0; col < MID_LEN; col++) {
    const vals = rows.map((r) => r.bytes[col]);
    const distinct = new Set(vals);
    if (distinct.size <= 1) continue; // constant — skip
    // skip known: +99 factionId, +135 ai_personality
    const tag = col === 99 ? " [factionId]" : col === 135 ? " [ai_personality]" : "";
    // Only show columns with moderate variety (reputation would be small int range)
    const max = Math.max(...vals), min = Math.min(...vals);
    console.log(`  +${String(col).padStart(3)} distinct=${distinct.size} range=${min}..${max}${tag}  vals=[${vals.join(",")}]`);
  }
}
