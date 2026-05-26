// v2: parse descr_strat by linking ";Name" headers to the following
// character_record block (which contains wife + children of that strategist).
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

// Build name -> v1 records
const nameToV1 = new Map();
for (const c of v1Records) {
  const n = c.firstName;
  if (!nameToV1.has(n)) nameToV1.set(n, []);
  nameToV1.get(n).push(c);
}

// Parse descr_strat:
//  - Each strategist (`character, X, named character`) defines a "family block".
//  - After the strategist's traits/army/ancillaries, blank-line-separated `character_record` lines below
//    are his children/wife.
//  - Pattern 2: a section comment ";Name" followed by character_records lists wife+children for "Name".
const stratLines = fs.readFileSync(stratPath, "utf8").split(/\r?\n/);

// Build family map: strategistName -> { wife: ?, kids: [] }
const families = new Map();
function ensureFam(name) { if (!families.has(name)) families.set(name, { wife: null, kids: [], source: [] }); return families.get(name); }

let currentStrategist = null;
let currentHeader = null;
for (let i = 0; i < stratLines.length; i++) {
  const raw = stratLines[i];
  const line = raw.trim();
  // ;HeaderName  → introduces a family block by name
  const hdr = line.match(/^;\s*(\S.*?)\s*$/);
  if (hdr) {
    // Header is the strategist (or dynasty member) the following records belong to
    // Strip leading whitespace
    const hname = hdr[1].split(/[,\s]/)[0];
    currentHeader = hname;
    currentStrategist = null;
    continue;
  }
  // character, Name, named character (strategist on map)
  const strat = line.match(/^character,\s*([A-Za-z_0-9]+),/);
  if (strat) {
    currentStrategist = strat[1];
    // The strategist becomes the implicit anchor for following character_records
    continue;
  }
  // character_record entries — attach to currentStrategist OR currentHeader
  const cr = line.match(/^character_record\s+([A-Za-z_0-9]+)\s*,\s*(male|female)\s*,\s*age\s+(\d+)/);
  if (cr) {
    const recName = cr[1], recGender = cr[2], recAge = +cr[3];
    // The strategist takes priority if set AND followed by an army block already
    // In RIS, families are usually under section headers (";X") so use headers
    const anchor = currentHeader || currentStrategist;
    if (anchor) {
      const fam = ensureFam(anchor);
      fam.source.push({ name: recName, gender: recGender, age: recAge, line: i });
      if (recGender === "female" && !fam.wife) fam.wife = { name: recName, age: recAge, line: i };
      else if (recGender === "male") fam.kids.push({ name: recName, age: recAge, line: i });
    }
    continue;
  }
  // blank line resets currentStrategist anchor (block ended)
  if (line === "") { currentStrategist = null; }
}

// Now: pull MISSES from v1 and look up the parent strategist's family
const allChildUuids = new Set();
for (const c of v1Records) for (const cu of (c.childUuids || [])) allChildUuids.add(cu);

const misses = [];
for (const c of v1Records) {
  if (c.lastName !== null) continue;
  if (c.offset < 47) continue;
  const slot46 = buf.readUInt32LE(c.offset + 46);
  if (slot46 === 0 || slot46 === 0xffffffff) continue;
  if (allChildUuids.has(slot46)) continue;
  misses.push({ name: c.firstName, slot46, offset: c.offset, age: c.age, role: c.role });
}

console.log(`Total slot46 misses (non-zero, not in child slots): ${misses.length}`);
console.log(`Total families parsed from descr_strat: ${families.size}`);

// For each miss, find the descr_strat family entry & wife
let wifeMatch = 0, wifeNoMatch = 0, noFamily = 0, noWife = 0;
const matchedSamples = [], unmatchedSamples = [];

for (const m of misses) {
  const fam = families.get(m.name);
  if (!fam) { noFamily++; if (unmatchedSamples.length < 10) unmatchedSamples.push({ ...m, reason: "no descr_strat family entry" }); continue; }
  if (!fam.wife) { noWife++; if (unmatchedSamples.length < 10) unmatchedSamples.push({ ...m, reason: "family in strat but no female", famSource: fam.source.map(s => s.name + ":" + s.gender).join(",") }); continue; }
  // Is there a v1 record matching this wife's name with primaryUuid == slot46?
  const wifeV1 = nameToV1.get(fam.wife.name) || [];
  const m1 = wifeV1.find(r => r.primaryUuid === m.slot46);
  if (m1) {
    wifeMatch++;
    if (matchedSamples.length < 15) matchedSamples.push({ husband: m.name, wife: fam.wife.name, slot46: m.slot46 });
  } else {
    wifeNoMatch++;
    if (unmatchedSamples.length < 25) unmatchedSamples.push({ ...m, reason: "wife in strat but v1 doesn't have her", wife: fam.wife.name, wifeV1Count: wifeV1.length });
  }
}

console.log(`\nMiss-classification:`);
console.log(`  Wife found in v1 with matching uuid: ${wifeMatch}  ← FRESH SPOUSE CONFIRMATIONS`);
console.log(`  Wife in descr_strat but no v1 with matching uuid: ${wifeNoMatch}`);
console.log(`  Family in descr_strat but no female wife: ${noWife}`);
console.log(`  No descr_strat family for this name: ${noFamily}`);

console.log(`\nMatched samples (validates +46 == spouseUuid):`);
for (const s of matchedSamples) console.log(`  ${s.husband} → wife ${s.wife} (uuid ${s.slot46})`);

console.log(`\nUnmatched samples:`);
for (const s of unmatchedSamples.slice(0, 15)) {
  console.log(`  ${s.name} slot46=${s.slot46} reason="${s.reason}"${s.wife ? ` wife="${s.wife}"` : ""}${s.famSource ? ` famSource=${s.famSource}` : ""}`);
}

// COUNTER-EVIDENCE: chars whose families show NO wife in descr_strat but slot46 is non-zero
// (these would be evidence that slot46 isn't spouseUuid)
let unmarriedWithSlot46 = 0;
for (const m of misses) {
  const fam = families.get(m.name);
  if (fam && fam.source.length > 0 && !fam.wife) unmarriedWithSlot46++;
}
console.log(`\n=== Unmarried-with-slot46 (potential counter-evidence) ===`);
console.log(`Chars in descr_strat with family block but NO wife, yet have slot46 != 0: ${unmarriedWithSlot46}`);

// Look at families with ONLY children, no wife (most likely widowed):
console.log("\nSample unmarried-with-children families:");
let shown = 0;
for (const m of misses) {
  if (shown >= 10) break;
  const fam = families.get(m.name);
  if (fam && fam.kids.length > 0 && !fam.wife) {
    console.log(`  ${m.name} slot46=${m.slot46} kids=[${fam.kids.map(k=>k.name).join(",")}] (no wife in strat)`);
    shown++;
  }
}

// Bonus: chars in strat with NO family block at all but slot46 set
let standaloneWithSlot46 = 0;
for (const m of misses) {
  if (!families.has(m.name)) standaloneWithSlot46++;
}
console.log(`\nChars with NO descr_strat family block (strategist with no header below): ${standaloneWithSlot46}`);
