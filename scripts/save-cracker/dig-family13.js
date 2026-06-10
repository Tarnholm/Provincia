#!/usr/bin/env node
// dig-family13.js — refine spouse pointer detection.
//
// The previous run had too many false-positive small-uuid matches. Tighten:
//   - Only accept wife candidates whose uuid is "uuid-shaped" (i.e., >= 1e5
//     to filter out tiny-int false matches).
//   - Restrict wife name search to the character-record zone of the file.
//   - For each known husband-wife pair, validate that the wife record is
//     plausibly a character record (has age field, female gender byte
//     check at +4).

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

const DSTR = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const strat = fs.readFileSync(DSTR, "utf8");
const pairs = [];
for (const raw of strat.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line.startsWith("relative")) continue;
  const idxEnd = line.toLowerCase().indexOf(" end");
  const head = (idxEnd > 0 ? line.slice(0, idxEnd) : line).replace(/^relative\s+/i, "");
  const parts = head.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) continue;
  const husband = parts[0];
  const wife = parts[1];
  const hParts = husband.split(/\s+/);
  pairs.push({
    husbandFirst: hParts[0],
    husbandLast: hParts.slice(1).join(" ") || null,
    wifeFirst: wife.split(/\s+/)[0],
  });
}
console.log(`Parsed ${pairs.length} husband-wife pairs from descr_strat`);

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const SAVE = path.join(SAVES, 'save_1.2.sav');
const buf = fs.readFileSync(SAVE);
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

const byFirstLast = new Map();
const offsetsUsed = new Set();
for (const r of recs) {
  const key = `${r.firstName}|${r.lastName||''}`;
  if (!byFirstLast.has(key)) byFirstLast.set(key, []);
  byFirstLast.get(key).push(r);
  offsetsUsed.add(r.offset);
}

// Determine character zone bounds
const charOffsets = recs.map(r => r.offset).sort((a,b)=>a-b);
const zoneMin = charOffsets[0] - 1000;
const zoneMax = charOffsets[charOffsets.length-1] + 1000;
console.log(`Character zone: ${zoneMin} .. ${zoneMax} (${recs.length} parsed records)`);

// Validator: does a position look like a character-record start?
// LAYOUT_B (4-byte shorter, no lastName): age at +22, pad9 at +5=0,
//   d34 at +30 (0x00 or >=0xf0)
// LAYOUT_A: age at +26, pad9 at +9=0, d34 at +34
function looksLikeCharRecord(pos) {
  // Try LAYOUT_A: u32 lastName at +5 should be a valid name index
  if (pos + 308 >= buf.length) return null;
  // gender byte at +4
  const gender = buf[pos + 4];
  // pad9 at +9 LAYOUT_A
  if (buf[pos+9] === 0) {
    const age = 242 - buf[pos + 26];
    const d34 = buf[pos + 34];
    if (age >= 0 && age <= 100 && (d34 === 0 || d34 >= 0xf0)) {
      return { layout: 'A', gender, age };
    }
  }
  // LAYOUT_B
  if (buf[pos+5] === 0) {
    const age = 242 - buf[pos + 22];
    const d34 = buf[pos + 30];
    if (age >= 0 && age <= 100 && (d34 === 0 || d34 >= 0xf0)) {
      return { layout: 'B', gender, age };
    }
  }
  return null;
}

const offsetHistogram = new Map();
const offsetExamples = new Map(); // offset -> [{husband, wife, ...}]
const matchedHusbands = [];

for (const p of pairs) {
  const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
  const husbands = byFirstLast.get(husbandKey);
  if (!husbands || husbands.length !== 1) continue;
  const h = husbands[0];
  const wifeIdx = nameToIdx.get(p.wifeFirst);
  if (wifeIdx == null) continue;

  // Find positions in CHARACTER ZONE where u32 == wifeIdx AND position looks like a character record
  const wifeCandidates = [];
  for (let i = zoneMin; i + 4 <= zoneMax; i++) {
    if (buf.readUInt32LE(i) !== wifeIdx) continue;
    if (offsetsUsed.has(i)) continue; // already a known male character
    const info = looksLikeCharRecord(i);
    if (!info) continue;
    // Validate: primaryUuid at pos-47/A or pos-43/B
    const layoutPrimaryOff = info.layout === 'A' ? 47 : 43;
    if (i - layoutPrimaryOff < 0) continue;
    const wifeUuid = buf.readUInt32LE(i - layoutPrimaryOff);
    if (wifeUuid === 0 || wifeUuid === 0xffffffff) continue;
    if (wifeUuid < 1000) continue; // skip tiny garbage uuids
    wifeCandidates.push({ pos: i, layout: info.layout, gender: info.gender, age: info.age, uuid: wifeUuid });
  }

  if (wifeCandidates.length === 0) continue;

  // For each wife candidate, check husband record for matching u32
  const hits = [];
  for (const wc of wifeCandidates) {
    for (let i = 0; i + 4 <= 200; i++) {
      if (buf.readUInt32LE(h.offset + i) === wc.uuid) {
        hits.push({ wife: wc, hOffset: i });
      }
    }
  }

  if (hits.length > 0) {
    matchedHusbands.push({ husband: husbandKey, wife: p.wifeFirst, wifeCandidates, hits, hLayout: h.lastName ? 'A' : 'B' });
    const seen = new Set();
    for (const hit of hits) {
      const key = hit.hOffset;
      if (seen.has(key)) continue;
      seen.add(key);
      offsetHistogram.set(hit.hOffset, (offsetHistogram.get(hit.hOffset)||0)+1);
      if (!offsetExamples.has(hit.hOffset)) offsetExamples.set(hit.hOffset, []);
      if (offsetExamples.get(hit.hOffset).length < 5) {
        offsetExamples.get(hit.hOffset).push({ husband: husbandKey, wife: p.wifeFirst, hLayout: h.lastName?'A':'B', wifeUuid: hit.wife.uuid, wifePos: hit.wife.pos, wifeLayout: hit.wife.layout, wifeAge: hit.wife.age, wifeGender: hit.wife.gender });
      }
    }
  }
}

console.log(`\nHusbands with wife candidates: ${matchedHusbands.length}`);
console.log(`\nOffset histogram (strict — wife uuid >= 1000, wife record looks valid):`);
const sorted = [...offsetHistogram.entries()].sort((a, b) => b[1] - a[1]);
for (const [off, count] of sorted.slice(0, 20)) {
  console.log(`  +${off}: ${count}`);
}

// Show top 3 offsets with examples
console.log(`\nTop offset examples:`);
for (const [off, count] of sorted.slice(0, 3)) {
  console.log(`\n+${off} (${count} hits):`);
  for (const ex of offsetExamples.get(off)) {
    console.log(`   husband=${ex.husband}(${ex.hLayout}) wife=${ex.wife} uuid=${ex.wifeUuid} wifePos=${ex.wifePos} wifeLayout=${ex.wifeLayout} wifeAge=${ex.wifeAge} wifeGender=${ex.wifeGender}`);
  }
}

// Per-layout offset histogram
console.log(`\nPer-husband-layout offset histogram:`);
const perLayout = { A: new Map(), B: new Map() };
for (const m of matchedHusbands) {
  const seen = new Set();
  for (const hit of m.hits) {
    if (seen.has(hit.hOffset)) continue;
    seen.add(hit.hOffset);
    perLayout[m.hLayout].set(hit.hOffset, (perLayout[m.hLayout].get(hit.hOffset)||0)+1);
  }
}
for (const L of ['A','B']) {
  const s = [...perLayout[L].entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
  console.log(`  LAYOUT_${L}:`, s.map(([o,c]) => `+${o}:${c}`).join(' '));
}
