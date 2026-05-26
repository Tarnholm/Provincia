// dig-diplocat-registry.js — enumerate the section type registry for ALL saves
// (RIS + vanilla) and flag diplomacy-related types. Also compares senate-type
// counts between vanilla (senate present) and RIS.
const fs = require("fs");

const SAVES = {
  "macedon t0 (RIS)":   "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
  "Seleucids t0 (RIS)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
  "t0 (vanilla)":       "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_t0.sav",
  "Autosave Rep Rome T5 (vanilla)": "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Autosave   Republic of Rome   Turn 5 Start.sav",
};

const DIPLO_RX = /DIPLO|ALLIANCE|WAR|PEACE|HOSTIL|TRADE|TRIBUTE|SENATE|ASSIST|APPEASE|SUBJUGATE|ANNEX|MISSION|OUTLIVE|BROKER|CEASE|ATTACK_OUTLAW|GIVE_BACK|GIVE_CASH|EXACT|DEMAND|TAKE_ROME|TAKE_CITY|FACTION|IMPERATOR|OFFICE/i;

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
  const startOff = p;
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
  return { startOff, endOff: p, types };
}

const allTables = {};
for (const [label, path] of Object.entries(SAVES)) {
  let buf;
  try { buf = fs.readFileSync(path); } catch { console.log(`\n### ${label}: NOT FOUND`); continue; }
  const { startOff, endOff, types } = readRegistry(buf);
  allTables[label] = types;
  console.log(`\n### ${label}  (${(buf.length / 1048576).toFixed(1)} MB)`);
  console.log(`registry @ 0x${startOff.toString(16)}..0x${endOff.toString(16)}  ${types.length} types`);
  const diplo = types.filter((t) => DIPLO_RX.test(t.name));
  console.log(`  diplomacy-related types (${diplo.length}):`);
  for (const t of diplo) console.log(`    ID ${String(t.id).padStart(3)} ${t.name.padEnd(34)} count=${t.count}`);
}

console.log("\n\n### SENATE-type count comparison (vanilla should have senate state, RIS may not)");
const senateRx = /SENATE|IMPERATOR|OFFICE|TAKE_ROME/i;
const labels = Object.keys(allTables);
const allNames = new Set();
for (const l of labels) for (const t of allTables[l]) if (senateRx.test(t.name)) allNames.add(t.name);
for (const name of allNames) {
  const row = labels.map((l) => {
    const t = allTables[l] && allTables[l].find((x) => x.name === name);
    return `${l.split(" ")[0]}=${t ? t.count : "-"}`;
  });
  console.log(`  ${name.padEnd(28)} ${row.join("  ")}`);
}
