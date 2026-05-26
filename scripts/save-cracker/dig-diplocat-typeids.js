// dig-diplocat-typeids.js
// The registry at 0x3310 is a STATIC engine class dictionary (byte-identical
// across all saves), so its "count" is NOT an instance count. To find which
// diplomacy structures are actually SERIALIZED, we look for the type-id being
// referenced in the body.
//
// In RTW:R taw serialization, a polymorphic object is written with a u16/u32
// type-id tag that indexes the registry, then its fields. We test the
// hypothesis that the registry index appears as a tag in the body by counting
// occurrences of each diplomacy type's id (as u16 and u32 LE) AND by scanning
// for the literal type-name string (some saves embed RTTI names inline).
const fs = require("fs");

const SAVES = {
  "macedon t0 (RIS)":   "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
  "t0 (vanilla)":       "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_t0.sav",
};

function readRegistry(buf) {
  let p = 0x3310;
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
  return types;
}

const DIPLO_NAMES = new Set([
  "DIPLOMATIC_ATTITUDE", "MAKE_ALLIANCE_BUILDER", "CEASE_HOSTILITIES_BUILDER",
  "BREAK_ALLIANCE_BUILDER", "DECLARE_WAR_BUILDER", "BROKER_PEACE_BUILDER",
  "MAKE_TRADE_AGREEMENT_BUILDER", "ASSIST_FACTION_BUILDER", "SUBJUGATE_BUILDER",
  "APPEASE_BUILDER", "GIVE_BACK_CITY_BUILDER", "ANNEX_CITY_BUILDER",
  "ATTACK_OUTLAW_FACTION_BUILDER", "DEMAND_SUICIDE_BUILDER", "EXACT_TRIBUTE_BUILDER",
  "GIVE_CASH_BUILDER", "TAKE_CITY_BASE_BUILDER",
  "AI_SENATE_FACTION", "AI_SENATE_FACTION_DATA", "SENATE_MISSION_IMPL",
  "SENATE_EVENT", "SENATE_SERVICE_HISTORY", "MISSION_HISTORY_ENTRY",
  "OUTLIVE_FACTIONS", "ASSASSINATION_MISSION", "IMPERATOR", "TAKE_ROME",
  "FACTION_ECONOMICS", "FACTION",
]);

function countBytes(buf, sub) {
  let n = 0, p = 0;
  while ((p = buf.indexOf(sub, p)) !== -1) { n++; p += 1; }
  return n;
}

for (const [label, path] of Object.entries(SAVES)) {
  let buf;
  try { buf = fs.readFileSync(path); } catch { console.log(`\n### ${label}: NOT FOUND`); continue; }
  const types = readRegistry(buf);
  console.log(`\n############ ${label} ############`);
  console.log("type-name string occurrences in body (beyond the single registry entry):");
  for (const t of types) {
    if (!DIPLO_NAMES.has(t.name)) continue;
    const strCount = countBytes(buf, Buffer.from(t.name + "\0", "latin1"));
    // u16 tag occurrences of the registry id (rough; expect noise)
    const tagBuf = Buffer.alloc(2); tagBuf.writeUInt16LE(t.id);
    const tag16 = countBytes(buf, tagBuf);
    console.log(`  ID ${String(t.id).padStart(3)} ${t.name.padEnd(34)} nameStr=${strCount}  (u16-tag occ=${tag16})`);
  }
}
