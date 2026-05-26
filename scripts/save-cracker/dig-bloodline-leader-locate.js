// dig-bloodline-leader-locate.js
//
// 211 Factionleader hits is implausible. Investigate: are the leader-flagged
// records REAL characters, or template/name-pool records? Cross-check against
// parseCharacterExtras (role-anchored, the reliable identity source) and look
// at the byte context of a leader's trait entry to confirm tid=457 is real.

const fs = require("fs");
const path = require("path");
const { findCharacterRecords } = require("../../src/characterParser.js");
const { parseCharacterExtras, parseFactionTreasuries } = require("../../src/saveCrackerExtras.js");

const SAVES = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";
const MOD_DIR = "C:\\RIS\\RIS\\data";
const nameLookup = fs.readFileSync(path.join(MOD_DIR, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitDeclOrder = [];
for (const line of fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/)) {
  const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitDeclOrder.push(tm[1]);
}

const argSave = process.argv[2] || "save_macedon t0.sav";
const buf = fs.readFileSync(path.join(SAVES, argSave));
console.log(`Save: ${argSave}\n`);

const v1 = findCharacterRecords(buf, nameLookup, traitDeclOrder, null);
const ext = parseCharacterExtras(buf);
const treas = parseFactionTreasuries(buf);
console.log(`v1 chars: ${v1.length}, ext chars (role-anchored): ${ext.length}, faction records: ${treas.length}\n`);

const extOwn = new Set(ext.map(c => c.ownUuid >>> 0));
const extByUuid = new Map(ext.map(c => [c.ownUuid >>> 0, c]));

const leaders = v1.filter(c => c.isLeader);
console.log(`v1 isLeader count: ${leaders.length}`);

// How many leader records correspond to a real role-anchored character
// (matched by primaryUuid==ownUuid OR secondaryUuid==bodyguardUuid)?
const extBg = new Map(ext.map(c => [c.bodyguardUuid >>> 0, c]));
let matchByPrimary = 0, matchByBg = 0, noMatch = 0;
const realLeaders = [];
for (const c of leaders) {
  const p = c.primaryUuid >>> 0, s = c.secondaryUuid >>> 0;
  if (extOwn.has(p)) { matchByPrimary++; realLeaders.push({ c, ext: extByUuid.get(p), via: "primary" }); }
  else if (extBg.has(s)) { matchByBg++; realLeaders.push({ c, ext: extBg.get(s), via: "bg" }); }
  else noMatch++;
}
console.log(`  leader records matching a role-anchored char: byPrimary=${matchByPrimary} byBodyguard=${matchByBg} noMatch=${noMatch}`);

// Group "real" leaders by region — should be ~1 per faction
console.log(`\nReal (role-anchored) leaders by region:`);
const byRegion = new Map();
for (const r of realLeaders) {
  const reg = r.ext.region;
  if (!byRegion.has(reg)) byRegion.set(reg, []);
  byRegion.get(reg).push(r);
}
for (const [reg, arr] of byRegion) {
  console.log(`  ${reg}: ${arr.map(r => `${r.c.firstName} ${r.c.lastName||""} (age ${r.c.age}, infl ${r.c.influence})`).join("; ")}`);
}

// Dump raw byte context of the trait entry for the FIRST few real leaders to
// confirm tid=457 (Factionleader) is genuinely present (not a parser artifact).
console.log(`\n=== Raw trait dump for first 3 real leaders ===`);
for (const r of realLeaders.slice(0, 3)) {
  const c = r.c;
  console.log(`\n${c.firstName} ${c.lastName||""} @0x${c.offset.toString(16)} region=${r.ext.region} traits=${c.traits.length}`);
  for (const t of c.traits) {
    const flag = (t.name === "Factionleader" || t.name === "Factionheir") ? "  <<<" : "";
    console.log(`    tid=${t.id} ${t.name} pts=${t.points}${flag}`);
  }
}
