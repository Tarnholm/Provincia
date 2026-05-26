// Final: parse descr_strat marriages via BOTH:
//  (a) explicit `relative HUSBAND, WIFE, CHILDREN..., end` lines
//  (b) `;Header` blocks containing a wife character_record
// Then test +46 (LAYOUT_B) and +50 (LAYOUT_A) AND +46 (LAYOUT_A) hypotheses.
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

// Build name -> v1 records (use firstName only — last names are separate field)
const nameToV1 = new Map();
for (const c of v1Records) {
  const k = c.firstName;
  if (!nameToV1.has(k)) nameToV1.set(k, []);
  nameToV1.get(k).push(c);
}

const stratLines = fs.readFileSync(stratPath, "utf8").split(/\r?\n/);

// --- Parse relative lines ---
// Format: `relative HUSBAND_NAME(s), WIFE_NAME, CHILD1, CHILD2, ..., end`
// HUSBAND may have surname (firstname + surname); WIFE/CHILDREN single names
const marriages = new Map(); // husband firstName -> wife firstName
for (const line of stratLines) {
  const m = line.trim().match(/^relative\s+(.+?),\s*([A-Za-z_0-9]+),(.*)end\s*$/i);
  if (!m) continue;
  // Husband name may include space (firstname surname). Take first token for v1 lookup
  const husband = m[1].trim().split(/\s+/)[0];
  const wife = m[2].trim();
  marriages.set(husband, wife);
}
console.log(`Parsed marriages from "relative" lines: ${marriages.size}`);

// --- Parse ;Header blocks ---
// Each ";Name" header followed by character_records: wife is first female
let currentHeader = null;
const headerWives = new Map();
for (let i = 0; i < stratLines.length; i++) {
  const line = stratLines[i].trim();
  const hdr = line.match(/^;\s*(\S.*?)\s*$/);
  if (hdr) {
    const hname = hdr[1].split(/[,\s]/)[0];
    currentHeader = hname;
    continue;
  }
  const cr = line.match(/^character_record\s+([A-Za-z_0-9]+)\s*,\s*(male|female)\s*,\s*age\s+(\d+)/);
  if (cr && currentHeader && cr[2] === "female") {
    if (!headerWives.has(currentHeader)) headerWives.set(currentHeader, cr[1]);
    continue;
  }
  if (line === "") { /* block separators inside section are fine */ }
}
console.log(`Inferred wives from ";Header" blocks (first female): ${headerWives.size}`);

// Merge: explicit relative beats header inference
function getWife(name) {
  return marriages.get(name) || headerWives.get(name) || null;
}

// Build set of all child uuids
const allChildUuids = new Set();
for (const c of v1Records) for (const cu of (c.childUuids || [])) allChildUuids.add(cu);

// === LAYOUT_B analysis with +46 ===
{
  let testable = 0, zero = 0, inChild = 0;
  let wifeMatched = 0, wifeUnmatched = 0, noWifeButSlot = 0, unmarriedSlot = 0;
  const unmarriedSamples = [];
  for (const c of v1Records) {
    if (c.lastName !== null) continue;
    if (c.offset < 47) continue;
    testable++;
    const slot46 = buf.readUInt32LE(c.offset + 46);
    if (slot46 === 0 || slot46 === 0xffffffff) { zero++; continue; }
    if (allChildUuids.has(slot46)) { inChild++; continue; }
    const wifeName = getWife(c.firstName);
    if (!wifeName) {
      // No wife in descr_strat — counter-evidence candidate
      unmarriedSlot++;
      if (unmarriedSamples.length < 15) unmarriedSamples.push({ name: c.firstName, slot46, age: c.age, role: c.role });
      continue;
    }
    const wifeV1 = nameToV1.get(wifeName) || [];
    const m1 = wifeV1.find(r => r.primaryUuid === slot46);
    if (m1) { wifeMatched++; }
    else wifeUnmatched++;
  }
  console.log(`\n=== LAYOUT_B / slot +46 ===`);
  console.log(`Testable: ${testable}`);
  console.log(`  zero/FF: ${zero}`);
  console.log(`  +46 in child slot (dynasty-confirmed spouse): ${inChild}`);
  console.log(`  +46 matches v1 wife by uuid (named in descr_strat): ${wifeMatched}`);
  console.log(`  +46 doesn't match v1 wife but wife is in descr_strat: ${wifeUnmatched}`);
  console.log(`  COUNTER-EVIDENCE: NO descr_strat wife but slot46 set: ${unmarriedSlot}`);
  console.log(`\n  Sample counter-evidence (descr_strat says unmarried, +46 != 0):`);
  for (const s of unmarriedSamples) console.log(`    ${s.name} (age ${s.age}, role=${s.role}) slot46=${s.slot46}`);
}

// === LAYOUT_A analysis: test BOTH +46 and +50 ===
{
  console.log(`\n=== LAYOUT_A: test +46 vs +50 ===`);
  const layoutA = v1Records.filter(c => c.lastName !== null && c.offset >= 47);
  console.log(`LAYOUT_A chars: ${layoutA.length}`);
  for (const offset of [42, 46, 50, 54]) {
    let zero = 0, inChild = 0, wifeMatched = 0, total = 0;
    for (const c of layoutA) {
      total++;
      const v = buf.readUInt32LE(c.offset + offset);
      if (v === 0 || v === 0xffffffff) { zero++; continue; }
      if (allChildUuids.has(v)) { inChild++; continue; }
      const wifeName = getWife(c.firstName);
      if (wifeName) {
        const wifeV1 = nameToV1.get(wifeName) || [];
        if (wifeV1.find(r => r.primaryUuid === v)) wifeMatched++;
      }
    }
    console.log(`  offset+${offset}: zero=${zero} inChild=${inChild} wifeMatched=${wifeMatched} total=${total}`);
  }
  // For LAYOUT_A: try matching slot to ANY v1 record (by primaryUuid)
  // Show what +50 actually points to
  console.log(`\n  LAYOUT_A +50 detailed:`);
  const uuidToV1 = new Map();
  for (const c of v1Records) if (c.primaryUuid) uuidToV1.set(c.primaryUuid, c);
  for (const c of layoutA) {
    const v50 = buf.readUInt32LE(c.offset + 50);
    const v46 = buf.readUInt32LE(c.offset + 46);
    const wifeName = getWife(c.firstName);
    const w50 = uuidToV1.get(v50);
    const w46 = uuidToV1.get(v46);
    console.log(`    ${c.firstName} ${c.lastName} +46=${v46}(→${w46 ? w46.firstName + ":" + w46.gender : "—"}) +50=${v50}(→${w50 ? w50.firstName + ":" + w50.gender : "—"}) descrStratWife=${wifeName || "?"}`);
  }
}

// === Dead-spouse / divorce edge case ===
// Are there v1 chars whose spouseUuid matches another v1 char that is DEAD?
// Look for slot46 values that match a "dead" v1 char (we don't have isDead
// directly but role=255 or specific markers might indicate it). Simpler:
// check the actual v1 char that's the spouse, look at THEIR slot46 — does
// it point back at the husband? That would imply slot46 is bidirectional.
{
  console.log(`\n=== Bidirectionality test ===`);
  // Build primaryUuid -> v1 record
  const uuidToV1 = new Map();
  for (const c of v1Records) if (c.primaryUuid) uuidToV1.set(c.primaryUuid, c);
  let bidirectional = 0, oneWay = 0, both = 0;
  for (const c of v1Records) {
    if (c.lastName !== null) continue;
    if (c.offset < 47) continue;
    const slot46 = buf.readUInt32LE(c.offset + 46);
    if (!slot46 || slot46 === 0xffffffff) continue;
    if (!allChildUuids.has(slot46)) continue; // only consider in-child cases
    const spouse = uuidToV1.get(slot46);
    if (!spouse) { oneWay++; continue; }
    // Check spouse's slot46
    const spouseSlot46 = buf.readUInt32LE(spouse.offset + (spouse.lastName === null ? 46 : 50));
    if (spouseSlot46 === c.primaryUuid) bidirectional++;
    else both++; // they exist in v1 but don't point back
  }
  console.log(`  Husband's slot46 points to spouse who exists in v1: ${both + bidirectional}`);
  console.log(`  ... and spouse's slot46 points back: ${bidirectional}`);
  console.log(`  ... but spouse's slot46 doesn't point back: ${both}`);
  console.log(`  Husband's slot46 points to char not in v1: ${oneWay}`);
}
