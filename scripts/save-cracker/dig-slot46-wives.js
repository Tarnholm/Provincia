// For each "miss" char in dig-slot46-crack, look up the descr_strat family block
// (header section) and find the immediately-following female character_record.
// Then check if that wife's name appears in v1 records anywhere.
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const stratPath = path.join(modPath, "data/world/maps/campaign/imperial_campaign/descr_strat.txt");

const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");
const traitsList = [];
for (const m of traitsTxt.matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traitsList.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const v1Records = findCharacterRecords(buf, names, traitsList, null);

// Build a name->records[] map for v1 lookup
const nameToV1 = new Map();
for (const c of v1Records) {
  const n = c.firstName;
  if (!nameToV1.has(n)) nameToV1.set(n, []);
  nameToV1.get(n).push(c);
}

// Parse descr_strat structure: walk through, track current "; HeaderName"
// section, and collect character_record entries with their gender + line.
const stratLines = fs.readFileSync(stratPath, "utf8").split(/\r?\n/);
const stratChars = []; // {name, gender, alive, header, lineIdx, age}
let currentHeader = null;
let currentFaction = null;
for (let i = 0; i < stratLines.length; i++) {
  const line = stratLines[i].trim();
  if (/^faction\s+/.test(line)) currentFaction = line.replace(/^faction\s+/, "").split(/[\s,]/)[0];
  const sec = line.match(/^;\s*(.+)/);
  if (sec) { currentHeader = sec[1].trim(); continue; }
  const cr = line.match(/^character_record\s+([A-Za-z_0-9]+)\s*,\s*(male|female)\s*,\s*age\s+(\d+)\s*,\s*(\w+)/);
  if (cr) {
    stratChars.push({ name: cr[1], gender: cr[2], age: +cr[3], state: cr[4], header: currentHeader, lineIdx: i, faction: currentFaction });
    continue;
  }
  const ch = line.match(/^character,\s*([A-Za-z_0-9]+),/);
  if (ch) {
    stratChars.push({ name: ch[1], gender: "male", header: currentHeader, lineIdx: i, faction: currentFaction, isStrategist: true });
  }
}

// For each test target, find the descr_strat header section and the wife record
const testTargets = ["DemetriosC", "KraterosB", "Ameinias", "Appuleius_Saturninus", "ArsinoeC", "Alexandros", "Zopyros", "Aischylos", "DemetriosD", "Perdikkas"];

// Also pull MORE misses from the v1 record set to test broadly
const moreMisses = [];
{
  const allChildUuids = new Set();
  for (const c of v1Records) for (const cu of (c.childUuids || [])) allChildUuids.add(cu);
  for (const c of v1Records) {
    if (c.lastName !== null) continue;
    if (c.offset < 47) continue;
    const slot46 = buf.readUInt32LE(c.offset + 46);
    if (slot46 === 0 || slot46 === 0xffffffff) continue;
    if (!allChildUuids.has(slot46)) moreMisses.push({ name: c.firstName, slot46, offset: c.offset, age: c.age });
  }
}

function findWifeInDescrStrat(target) {
  // Find target's descr_strat entry (either character or character_record)
  let idx = -1;
  for (let i = 0; i < stratChars.length; i++) {
    if (stratChars[i].name === target) { idx = i; break; }
  }
  if (idx < 0) return null;
  const t = stratChars[idx];
  // Wife candidates: prev/next female with same header, age within +/- 30 years
  const cands = [];
  for (let j = Math.max(0, idx - 6); j < Math.min(stratChars.length, idx + 6); j++) {
    if (j === idx) continue;
    const c = stratChars[j];
    if (c.gender !== "female") continue;
    if (c.header && t.header && c.header === t.header) cands.push({ ...c, distance: Math.abs(j - idx), reason: "same-header" });
  }
  // Also: stratChars may have target as a "character" (strategist) followed
  // by character_records (children + wife). The wife is the first female
  // *immediately following* the strategist line before another character.
  if (t.isStrategist) {
    for (let j = idx + 1; j < Math.min(stratChars.length, idx + 8); j++) {
      const c = stratChars[j];
      if (c.isStrategist) break;
      if (c.gender === "female") cands.push({ ...c, distance: j - idx, reason: "follow-strategist" });
    }
  }
  return cands;
}

for (const target of testTargets) {
  const wives = findWifeInDescrStrat(target);
  const v1Self = nameToV1.get(target) || [];
  const slot46 = v1Self[0] ? buf.readUInt32LE(v1Self[0].offset + 46) : null;
  console.log(`\n${target}: v1=${v1Self.length} record(s), +46=${slot46}`);
  if (!wives || wives.length === 0) { console.log("  no wife candidates in descr_strat"); continue; }
  for (const w of wives) {
    const v1W = nameToV1.get(w.name) || [];
    const uuids = v1W.map(r => r.primaryUuid);
    const match = uuids.find(u => u === slot46);
    console.log(`  wife candidate: ${w.name} (age ${w.age}, ${w.reason}, hdr "${w.header}") → ${v1W.length} v1 record(s) uuids=${uuids.join(",")} match=${match || "NO"}`);
  }
}

// SECONDARY ANALYSIS: how many of the 610 misses actually do have a v1 record
// for their slot46 uuid (as ANY v1 record, not just child slot)?
{
  const uuidToV1 = new Map();
  for (const c of v1Records) {
    if (c.primaryUuid) uuidToV1.set(c.primaryUuid, c);
  }
  let inV1 = 0, notInV1 = 0;
  const samples = [];
  for (const m of moreMisses) {
    const hit = uuidToV1.get(m.slot46);
    if (hit) { inV1++; if (samples.length < 15) samples.push({ src: m, hit }); }
    else notInV1++;
  }
  console.log(`\n=== Slot46 misses analysis ===`);
  console.log(`Total non-child-slot misses: ${moreMisses.length}`);
  console.log(`  slot46 IS a v1 primaryUuid (just not anyone's child): ${inV1}`);
  console.log(`  slot46 NOT any v1 primaryUuid: ${notInV1}`);
  console.log(`Hit samples (slot46 points to an existing v1 char):`);
  for (const s of samples) {
    console.log(`  ${s.src.name} (age ${s.src.age}) → slot46 → ${s.hit.firstName} (age ${s.hit.age}, gender=${s.hit.gender}, role=${s.hit.role})`);
  }
}

// COUNTER-EVIDENCE search: chars whose slot46 matches a UNIT secondaryUuid
// (which would imply slot46 is some other reference)
{
  const secondaryUuidSet = new Set();
  for (const c of v1Records) if (c.secondaryUuid && c.secondaryUuid !== 0xffffffff) secondaryUuidSet.add(c.secondaryUuid);
  let slot46AsSecondary = 0;
  const samples = [];
  for (const c of v1Records) {
    if (c.lastName !== null) continue;
    if (c.offset < 47) continue;
    const slot46 = buf.readUInt32LE(c.offset + 46);
    if (!slot46 || slot46 === 0xffffffff) continue;
    if (secondaryUuidSet.has(slot46)) {
      slot46AsSecondary++;
      if (samples.length < 5) samples.push({ name: c.firstName, slot46 });
    }
  }
  console.log(`\n=== Counter-evidence: slot46 == some v1 char's secondaryUuid (unit cmd)? ===`);
  console.log(`Count: ${slot46AsSecondary}`);
  for (const s of samples) console.log(` ${s.name}: ${s.slot46}`);
}
