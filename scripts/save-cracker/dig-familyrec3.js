#!/usr/bin/env node
// dig-familyrec3.js — Session 41 attempt 3.
//
// Findings so far (familyrec1/2):
//   +0..+3   marker 0x0000052e
//   +4..+7   00 00 00 00
//   +8..+15  ff ff ff ff ff ff ff ff (8 bytes 0xff, very stable — like main char sentinel)
//   +16      age (242 - age)
//   +17..+19 ff ff ff (continuation of sentinel? or padding)
//   +20      u32 ~50% zero / ~50% =2
//   +24..+27 00 00 00 00
//   +28      u32 always 2
//   +32      u32 always 0
//   +36      u32 = primaryUuid-shaped (varies, sometimes 0) — POSSIBLE wife self uuid?
//   +40      husband.primaryUuid CONFIRMED
//   +44..+76 mostly zeros
//   +80      u32 like 0x00010c81 — VARIES per record (141 unique values)
//   +84      00 00 00 00
//   +88      u32 = 0x32 (=50) constant
//   +358     u16 child name idx (HYPOTHESIS, 83% hit)
//
// Goal: confirm +36 IS wife's own primaryUuid by:
//   (a) checking +36 values are unique across records (UUIDs must be)
//   (b) checking +36 is in the global "fatherUuid" pool of OTHER family records
//       (a wife is sometimes the mother of a child in another wife record)
//   (c) cross-referencing with husband's character record children-array
//
// Goal: confirm +358 child idx by checking it equals firstName of a known child.
//
// Goal: investigate +20 (50/50), +80 (packed), +16+2 (the s16 we read as -1)

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/RIS/RIS/data";
const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const nameToIdx = new Map();
nameLookup.forEach((n, i) => { if (n) nameToIdx.set(n, i); });
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) { const tm = line.match(/^Trait\s+(\S+)/); if (tm) traitNames.push(tm[1]); }
}

const strat = fs.readFileSync("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt", "utf8");
const stratLines = strat.split(/\r?\n/);
const charAge = new Map();
const charFaction = new Map();
let currentFaction = null;
for (const raw of stratLines) {
  const line = raw.trim();
  const fm = line.match(/^faction\s+([a-z_]+)/);
  if (fm) { currentFaction = fm[1]; continue; }
  let m = line.match(/^character,\s*(?:sub_faction\s+\S+,\s*)?([^,]+?),.*?age\s+(\d+)/);
  if (m) { charAge.set(m[1].trim(), parseInt(m[2],10)); charFaction.set(m[1].trim(), currentFaction); continue; }
  m = line.match(/^character_record\s+(.+?),\s+(male|female),\s+age\s+(\d+)/);
  if (m) { charAge.set(m[1].trim(), parseInt(m[3],10)); charFaction.set(m[1].trim(), currentFaction); }
}
const pairs = [];
for (const raw of stratLines) {
  const line = raw.trim();
  if (!line.toLowerCase().startsWith("relative")) continue;
  const idxEnd = line.toLowerCase().indexOf("end");
  const head = (idxEnd > 0 ? line.slice(0, idxEnd) : line).replace(/^relative\s*/i, "");
  const parts = head.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) continue;
  pairs.push({ husband: parts[0], wife: parts[1], children: parts.slice(2) });
}

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVES, 'save_1.2.sav'));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const byFullName = new Map();
for (const r of recs) {
  const k = r.lastName ? `${r.firstName} ${r.lastName}` : r.firstName;
  if (!byFullName.has(k)) byFullName.set(k, []);
  byFullName.get(k).push(r);
}

const groundTruth = [];
for (const p of pairs) {
  const hL = byFullName.get(p.husband);
  if (!hL || hL.length !== 1) continue;
  groundTruth.push({
    wifeFirst: p.wife.split(/\s+/)[0],
    wifeAge: charAge.get(p.wife),
    husband: p.husband,
    husbandRec: hL[0],
    children: p.children,
    faction: charFaction.get(p.husband),
  });
}
const wifeNameToGTs = new Map();
for (const gt of groundTruth) {
  const idx = nameToIdx.get(gt.wifeFirst);
  if (idx != null) {
    if (!wifeNameToGTs.has(idx)) wifeNameToGTs.set(idx, []);
    wifeNameToGTs.get(idx).push(gt);
  }
}

const markers = [];
for (let i = 20000000; i < 24000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}

const matched = [];
for (const m of markers) {
  const widx = buf.readUInt32LE(m - 6);
  const gts = wifeNameToGTs.get(widx);
  if (!gts) continue;
  const hpUuid = buf.readUInt32LE(m + 40);
  const gt = gts.find(g => g.husbandRec.primaryUuid === hpUuid);
  if (!gt) continue;
  matched.push({m, gt});
}

// ---- Investigate +36 ----
// Q1: is +36 unique across records?
const at36 = new Map(); // val → count
let nonZero36 = 0;
for (const m of markers) {
  const v = buf.readUInt32LE(m + 36);
  at36.set(v, (at36.get(v)||0) + 1);
  if (v) nonZero36++;
}
console.log(`+36 values: ${at36.size} unique among ${markers.length} records; nonZero=${nonZero36}`);
const dups36 = [...at36.entries()].filter(([v,c]) => v !== 0 && c > 1);
console.log(`  duplicate nonzero +36 values: ${dups36.length}`);

// Q2: does +36 of any record appear at +40 of ANOTHER record (i.e. wife is mother)?
const at40s = new Set();
for (const m of markers) {
  const v = buf.readUInt32LE(m + 40);
  if (v) at40s.add(v);
}
let crossLinks36to40 = 0;
const crossSamples = [];
for (const m of markers) {
  const v36 = buf.readUInt32LE(m + 36);
  if (v36 && at40s.has(v36)) {
    crossLinks36to40++;
    if (crossSamples.length < 5) {
      // who is this record (wife name)?
      const widx = buf.readUInt32LE(m - 6);
      const wifeName = nameLookup[widx];
      // Find which OTHER record has +40 == v36
      const otherMarkers = markers.filter(om => om !== m && buf.readUInt32LE(om + 40) === v36);
      const otherNames = otherMarkers.map(om => `${nameLookup[buf.readUInt32LE(om - 6)] || '?'}@${om}`);
      crossSamples.push(`  ${wifeName}@${m} +36=${v36} → also at +40 of: ${otherNames.join(', ')}`);
    }
  }
}
console.log(`+36 of one record == +40 of another (wife-is-someone's-parent cross-link): ${crossLinks36to40}`);
for (const s of crossSamples) console.log(s);

// Q3: how often is a known husband's children-array UUID present at the wife's +36?
// If wife.recordOffset+36 == husband.children[0].primaryUuid, that's the wife being linked
// as someone's child themselves (wife's father).
// (Actually we want the WIFE's primaryUuid here — let's check whether husband's record
// has the wife's +36 value somewhere in its children/family list.)
let wifeAt36IsHusbandChild = 0;
for (const {m, gt} of matched) {
  const v36 = buf.readUInt32LE(m + 36);
  if (!v36) continue;
  // Look in husband's full window (offset to offset+200) for v36.
  for (let o = 0; o <= 250; o++) {
    const pos = gt.husbandRec.offset + o;
    if (pos + 4 > buf.length) break;
    if (buf.readUInt32LE(pos) === v36) {
      wifeAt36IsHusbandChild++;
      break;
    }
  }
}
console.log(`wife's +36 found in husband's record window (0..250): ${wifeAt36IsHusbandChild}/${matched.length}`);

// ---- Investigate +358 child name idx ----
console.log(`\n=== +358 u16 (child name candidate) ===`);
let childAt358 = 0, totalChildCheckable = 0, sampleMatches = [], sampleNonMatches = [];
for (const {m, gt} of matched) {
  if (!gt.children.length) continue;
  totalChildCheckable++;
  const idx = buf.readUInt16LE(m + 358);
  const childNames = gt.children.map(c => c.split(/\s+/)[0]);
  const childIdxs = new Set(childNames.map(c => nameToIdx.get(c)).filter(x => x != null));
  const isMatch = childIdxs.has(idx);
  if (isMatch) childAt358++;
  if (isMatch && sampleMatches.length < 5) sampleMatches.push(`  ${gt.wifeFirst}: +358=${idx} (${nameLookup[idx]}) ∈ ${childNames.join(',')}`);
  if (!isMatch && sampleNonMatches.length < 5) sampleNonMatches.push(`  ${gt.wifeFirst}: +358=${idx} (${nameLookup[idx]||'?'}) NOT in ${childNames.join(',')}`);
}
console.log(`+358 matches a known child first name: ${childAt358}/${totalChildCheckable}`);
sampleMatches.forEach(s => console.log(s));
console.log(`Non-matches:`);
sampleNonMatches.forEach(s => console.log(s));

// ---- Now scan FULL window for child UUID/name-idx hits (multiple children possible) ----
console.log(`\n=== Scan -16..+360 for each child's u16 name idx (firstName) ===`);
const childIdxOffHist = new Map();
let totalChildSlots = 0;
for (const {m, gt} of matched) {
  for (const c of gt.children) {
    const idx = nameToIdx.get(c.split(/\s+/)[0]);
    if (idx == null) continue;
    totalChildSlots++;
    for (let o = -20; o <= 360; o++) {
      const pos = m + o;
      if (pos < 0 || pos + 2 > buf.length) continue;
      if (buf.readUInt16LE(pos) === idx) {
        childIdxOffHist.set(o, (childIdxOffHist.get(o)||0) + 1);
      }
    }
  }
}
console.log(`Total (wife,child) pairs: ${totalChildSlots}`);
const sorted = [...childIdxOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15);
for (const [o, c] of sorted) console.log(`  ${o>=0?'+':''}${o}: ${c} (${(100*c/totalChildSlots).toFixed(0)}%)`);

// ---- Investigate +80 ---- (varies 141 unique values, sample 0x00010c81)
// Decompose: bits? Looks like 0x00010841, 0x00010741, 0x00010881, 0x00010c81 — high nibble of low word varies.
console.log(`\n=== +80 u32 patterns ===`);
for (const {m, gt} of matched.slice(0, 16)) {
  const v = buf.readUInt32LE(m + 80);
  const age = 242 - buf[m+16];
  console.log(`  ${gt.wifeFirst.padEnd(15)} age=${age.toString().padStart(2)} +80=0x${v.toString(16).padStart(8,'0')} bin(low16)=${(v & 0xffff).toString(2).padStart(16,'0')}`);
}

// ---- Investigate father/mother of the WIFE (grandparents) ----
// For this we'd need a known wife whose own father is named in descr_strat.
// descr_strat "relative" sometimes only lists wife/children — wife's parents
// might appear if the wife's father is also a leader.
// Quick test: does any u32 in the wife's record (excluding +40) equal a known
// character's primaryUuid that is NOT the husband and NOT a child?
console.log(`\n=== Non-husband non-child UUID hits in wife record window (excluding +40) ===`);
const otherUuidOffHist = new Map();
let nonChildrenWives = 0;
const allRecUuids = new Map(); // primaryUuid → fullName
for (const r of recs) {
  if (r.primaryUuid) allRecUuids.set(r.primaryUuid, `${r.firstName}${r.lastName?' '+r.lastName:''}`);
}
let samplePool = [];
for (const {m, gt} of matched) {
  const childUuids = new Set(gt.children.map(c => {
    const k = c.split(/\s+/)[0];
    const list = byFullName.get(c) || byFullName.get(k);
    return (list && list[0] && list[0].primaryUuid) || null;
  }).filter(Boolean));
  nonChildrenWives++;
  for (let o = -20; o <= 360 - 4; o += 1) {
    if (o === 40) continue;
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    if (v && allRecUuids.has(v) && v !== gt.husbandRec.primaryUuid && !childUuids.has(v)) {
      otherUuidOffHist.set(o, (otherUuidOffHist.get(o)||0) + 1);
      if (samplePool.length < 30) samplePool.push(`  ${gt.wifeFirst} +${o}: ${allRecUuids.get(v)} (uuid=${v})`);
    }
  }
}
console.log(`Wives with non-husband-non-child known UUID hits in record (offsets, top 12):`);
for (const [o, c] of [...otherUuidOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) {
  console.log(`  ${o>=0?'+':''}${o}: ${c} (${(100*c/nonChildrenWives).toFixed(0)}%)`);
}
console.log(`Sample matches:`);
samplePool.slice(0, 12).forEach(s => console.log(s));

// ---- Confirm record START offset by looking at all bytes in the range marker-50..marker (next marker) ----
// Use median pre-marker = the lower bound of a record.
console.log(`\n=== Pre-marker zero-block analysis (find record start) ===`);
// For each marker, walk backwards until we hit a nonzero byte; report distance.
const preNzHist = new Map();
for (const m of markers) {
  let dist = 0;
  for (let o = -1; o >= -50; o--) {
    if (buf[m + o] !== 0) { dist = -o; break; }
    if (o === -50) dist = 50;
  }
  preNzHist.set(dist, (preNzHist.get(dist)||0) + 1);
}
for (const [d, c] of [...preNzHist.entries()].sort((a,b)=>a[0]-b[0]).slice(0, 12)) {
  console.log(`  pre-marker zero run: ${d} bytes back → ${c} records`);
}
