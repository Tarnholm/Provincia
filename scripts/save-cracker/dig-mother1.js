#!/usr/bin/env node
// dig-mother1.js — Session 89 attempt 1.
//
// Goal: find mother→child linkage. Wives have no primary UUID (session 41
// NEGATIVE). So how is a son linked to his MOTHER?
//
// Hypotheses:
//   H1: child character record carries a u16 (or u32) name-index matching
//       the mother's firstName-idx (at wife-record marker-6).
//   H2: wife record body contains a 4-byte child UUID array.
//   H3: mother is NOT tracked — only father is.
//
// Method:
//   - Parse character records + wife records.
//   - Build ground-truth (father, wife, [children]) tuples from descr_strat
//     "relative" lines.
//   - For each (wife, child) pair we have a match for, locate the wife's
//     marker offset (via husband uuid at marker+40) and the child's
//     character record offset.
//   - SCAN A: child record full body (offset+0 .. offset+450) for any u16
//     == wife.firstNameIdx → if a peak emerges, that's mother's name idx.
//   - SCAN B: child record full body for any u32 == anything that the wife
//     record carries that ISN'T already a fingerprint of the husband.
//   - SCAN C: wife record body (marker-20..+360) for any u32 == child's
//     primaryUuid → would prove H2 (children-array in wife record).

const fs = require('fs');
const path = require('path');
const cp = require('C:/dev/Provincia/src/characterParser.js');

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
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

console.log(`Total character records parsed: ${recs.length}`);
console.log(`Total relative tuples in descr_strat: ${pairs.length}`);

// Build ground truth: (husband_rec, wife_first_idx, [child_rec])
const groundTruth = [];
for (const p of pairs) {
  const hL = byFullName.get(p.husband);
  if (!hL || hL.length !== 1) continue;
  const wifeFirst = p.wife.split(/\s+/)[0];
  const wifeFirstIdx = nameToIdx.get(wifeFirst);
  if (wifeFirstIdx == null) continue;
  const childRecs = [];
  for (const c of p.children) {
    // child uses husband's lastName usually; some children are unmarried
    // daughters (single name e.g. "Prisca"). For lookups, match by full name first.
    const tryFull = byFullName.get(c);
    if (tryFull && tryFull.length >= 1) {
      childRecs.push({ name: c, rec: tryFull[0] });
      continue;
    }
    // Try with husband's lastName tacked on
    const husbandLast = p.husband.includes(" ") ? p.husband.split(/\s+/).slice(1).join(" ") : null;
    if (husbandLast) {
      const guess = `${c} ${husbandLast}`;
      const list = byFullName.get(guess);
      if (list && list.length >= 1) {
        childRecs.push({ name: guess, rec: list[0] });
        continue;
      }
    }
  }
  if (!childRecs.length) continue;
  groundTruth.push({
    husband: p.husband,
    husbandRec: hL[0],
    wife: p.wife,
    wifeFirst,
    wifeFirstIdx,
    childRecs,
  });
}
console.log(`Ground-truth tuples with husband+>=1 child resolved: ${groundTruth.length}`);
let totalChildren = 0;
for (const gt of groundTruth) totalChildren += gt.childRecs.length;
console.log(`Total (mother, child) pairs available: ${totalChildren}`);

// Find wife records (markers @ 0x52e in 20M-24M range), build wifeFirstIdx → markerOffset map
const markers = [];
for (let i = 20000000; i < 24000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}
console.log(`Wife record markers in 20-24M range: ${markers.length}`);

// For each ground truth wife, find the marker where:
//   marker-6 == wifeFirstIdx AND marker+40 == husband.primaryUuid
const gtWithWifeMarker = [];
for (const gt of groundTruth) {
  let foundMarker = null;
  for (const m of markers) {
    if (buf.readUInt32LE(m - 6) === gt.wifeFirstIdx) {
      if (buf.readUInt32LE(m + 40) === gt.husbandRec.primaryUuid) {
        foundMarker = m;
        break;
      }
    }
  }
  if (foundMarker != null) gtWithWifeMarker.push({ ...gt, wifeMarker: foundMarker });
}
console.log(`Ground-truth tuples with wife marker resolved: ${gtWithWifeMarker.length}`);

// --- SCAN A: child record body for u16 == wife.firstNameIdx ---
// child record offsets are 0 .. 450 inclusive (overshoots traits/portrait, that's fine)
console.log(`\n=== SCAN A: child record u16 == mother.firstNameIdx ===`);
const u16OffHist = new Map();
let totalPairsA = 0;
const samplesA = new Map(); // off → first 3 samples
for (const gt of gtWithWifeMarker) {
  for (const cr of gt.childRecs) {
    totalPairsA++;
    const cOff = cr.rec.offset;
    for (let o = -20; o <= 450; o++) {
      const pos = cOff + o;
      if (pos < 0 || pos + 2 > buf.length) continue;
      if (buf.readUInt16LE(pos) === gt.wifeFirstIdx) {
        u16OffHist.set(o, (u16OffHist.get(o)||0) + 1);
        if (!samplesA.has(o)) samplesA.set(o, []);
        if (samplesA.get(o).length < 3) samplesA.get(o).push(`${gt.wifeFirst}→${cr.name}`);
      }
    }
  }
}
console.log(`(mother,child) pairs tested: ${totalPairsA}`);
const sortedA = [...u16OffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 18);
for (const [o, c] of sortedA) {
  const pct = (100*c/totalPairsA).toFixed(0);
  const sample = (samplesA.get(o) || []).join('; ');
  console.log(`  child${o>=0?'+':''}${o}: ${c}/${totalPairsA} (${pct}%) ex: ${sample}`);
}

// --- SCAN B: child record body for u32 == wife.firstNameIdx (treats it as a u32 name idx) ---
console.log(`\n=== SCAN B: child record u32 == mother.firstNameIdx ===`);
const u32OffHist = new Map();
for (const gt of gtWithWifeMarker) {
  for (const cr of gt.childRecs) {
    const cOff = cr.rec.offset;
    for (let o = -20; o <= 450 - 4; o++) {
      const pos = cOff + o;
      if (pos < 0 || pos + 4 > buf.length) continue;
      if (buf.readUInt32LE(pos) === gt.wifeFirstIdx) {
        u32OffHist.set(o, (u32OffHist.get(o)||0) + 1);
      }
    }
  }
}
const sortedB = [...u32OffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
for (const [o, c] of sortedB) {
  const pct = (100*c/totalPairsA).toFixed(0);
  console.log(`  child${o>=0?'+':''}${o}: ${c}/${totalPairsA} (${pct}%)`);
}

// --- SCAN C: wife record body for u32 == child.primaryUuid ---
console.log(`\n=== SCAN C: wife record window contains child.primaryUuid ===`);
const wifeOffHist = new Map();
let pairsC = 0;
const samplesC = new Map();
for (const gt of gtWithWifeMarker) {
  for (const cr of gt.childRecs) {
    const cuuid = cr.rec.primaryUuid;
    if (!cuuid) continue;
    pairsC++;
    const m = gt.wifeMarker;
    for (let o = -50; o <= 380 - 4; o++) {
      const pos = m + o;
      if (pos < 0 || pos + 4 > buf.length) continue;
      if (buf.readUInt32LE(pos) === cuuid) {
        wifeOffHist.set(o, (wifeOffHist.get(o)||0) + 1);
        if (!samplesC.has(o)) samplesC.set(o, []);
        if (samplesC.get(o).length < 3) samplesC.get(o).push(`${gt.wifeFirst}→${cr.name}`);
      }
    }
  }
}
console.log(`(mother,child) pairs with child UUID tested: ${pairsC}`);
const sortedC = [...wifeOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 18);
for (const [o, c] of sortedC) {
  const pct = (100*c/pairsC).toFixed(0);
  const sample = (samplesC.get(o) || []).join('; ');
  console.log(`  wife${o>=0?'+':''}${o}: ${c}/${pairsC} (${pct}%) ex: ${sample}`);
}

// --- SCAN D: child record has father uuid at +46. Already known. What ABOUT child's body for ANY
// match against the wife's marker offset / wife's father uuid at marker+36? ---
console.log(`\n=== SCAN D: child record contains wife-marker+36 value (wife's father uuid candidate) ===`);
const mfOffHist = new Map();
let pairsD = 0;
const samplesD = new Map();
for (const gt of gtWithWifeMarker) {
  const wf36 = buf.readUInt32LE(gt.wifeMarker + 36);
  if (!wf36) continue;
  for (const cr of gt.childRecs) {
    pairsD++;
    const cOff = cr.rec.offset;
    for (let o = -20; o <= 450 - 4; o++) {
      const pos = cOff + o;
      if (pos < 0 || pos + 4 > buf.length) continue;
      if (buf.readUInt32LE(pos) === wf36) {
        mfOffHist.set(o, (mfOffHist.get(o)||0) + 1);
        if (!samplesD.has(o)) samplesD.set(o, []);
        if (samplesD.get(o).length < 3) samplesD.get(o).push(`${gt.wifeFirst}→${cr.name}`);
      }
    }
  }
}
console.log(`(mother,child) pairs tested: ${pairsD}`);
const sortedD = [...mfOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
for (const [o, c] of sortedD) {
  const pct = (100*c/pairsD).toFixed(0);
  const sample = (samplesD.get(o) || []).join('; ');
  console.log(`  child${o>=0?'+':''}${o}: ${c}/${pairsD} (${pct}%) ex: ${sample}`);
}

// --- SCAN E: u16 of child's first name in wife record body (children-as-name-idx array) ---
console.log(`\n=== SCAN E: wife record contains child.firstName u16 ===`);
const wnHist = new Map();
let pairsE = 0;
for (const gt of gtWithWifeMarker) {
  for (const cr of gt.childRecs) {
    const cname = cr.rec.firstName;
    const idx = nameToIdx.get(cname);
    if (idx == null) continue;
    pairsE++;
    const m = gt.wifeMarker;
    for (let o = -20; o <= 380; o++) {
      const pos = m + o;
      if (pos < 0 || pos + 2 > buf.length) continue;
      if (buf.readUInt16LE(pos) === idx) {
        wnHist.set(o, (wnHist.get(o)||0) + 1);
      }
    }
  }
}
console.log(`(mother,child) pairs tested: ${pairsE}`);
const sortedE = [...wnHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
for (const [o, c] of sortedE) {
  const pct = (100*c/pairsE).toFixed(0);
  console.log(`  wife${o>=0?'+':''}${o}: ${c}/${pairsE} (${pct}%)`);
}

// Print a sample (mother, child) pair for sanity
console.log(`\n=== Sample tuples ===`);
for (const gt of gtWithWifeMarker.slice(0, 5)) {
  console.log(`  ${gt.husband} (uuid=${gt.husbandRec.primaryUuid}) × ${gt.wife} (marker=${gt.wifeMarker}, +36=${buf.readUInt32LE(gt.wifeMarker+36)})`);
  for (const cr of gt.childRecs) {
    console.log(`     child: ${cr.name} @off=${cr.rec.offset} uuid=${cr.rec.primaryUuid} father=${cr.rec.fatherUuid}`);
  }
}
