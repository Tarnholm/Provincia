#!/usr/bin/env node
// dig-familyrec1.js — Session 41: byte-level layout of wife records at 21.5M-23M.
//
// Goal: find offsets for (a) wife's own primaryUuid, (b) age, (c) child links,
// (d) trait block, (e) faction id, (f) wife's father/mother (grandparents).
//
// Method: parse descr_strat for a "ground truth" map of wife → husband, age,
// children, parents. Iterate every 2e 05 00 00 marker, pull the wife by
// husbandUuid@marker+40, then search the entire record window for known
// u32 / age values and build a histogram of offsets.

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

// Parse descr_strat:
//   - factions (so we can match faction id)
//   - characters → age
//   - character_records → age, gender, alive
//   - relative blocks → husband, wife, children
const strat = fs.readFileSync("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt", "utf8");
const stratLines = strat.split(/\r?\n/);

// Build a charAge map keyed by "FirstName LastName" or "FirstName" (last optional).
const charAge = new Map();      // fullName → age
const charGender = new Map();
let currentFaction = null;
const factionOrder = [];
const charFaction = new Map();
for (const raw of stratLines) {
  const line = raw.trim();
  const fm = line.match(/^faction\s+([a-z_]+)/);
  if (fm) { currentFaction = fm[1]; factionOrder.push(currentFaction); continue; }
  let m = line.match(/^character,\s*(?:sub_faction\s+\S+,\s*)?([^,]+?),.*?age\s+(\d+)/);
  if (m) {
    const name = m[1].trim();
    charAge.set(name, parseInt(m[2], 10));
    charFaction.set(name, currentFaction);
    continue;
  }
  m = line.match(/^character_record\s+(.+?),\s+(male|female),\s+age\s+(\d+)/);
  if (m) {
    const name = m[1].trim();
    charAge.set(name, parseInt(m[3], 10));
    charGender.set(name, m[2]);
    charFaction.set(name, currentFaction);
    continue;
  }
}

// relative lines: husband, wife, child1, child2, ... end
const pairs = []; // { husband, wife, children: [...] }
for (const raw of stratLines) {
  const line = raw.trim();
  if (!line.toLowerCase().startsWith("relative")) continue;
  const idxEnd = line.toLowerCase().indexOf("end");
  const head = (idxEnd > 0 ? line.slice(0, idxEnd) : line).replace(/^relative\s*/i, "");
  const parts = head.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) continue;
  const husband = parts[0];
  const wife = parts[1];
  const children = parts.slice(2);
  pairs.push({ husband, wife, children });
}

// Parse the main character record list with characterParser to get UUIDs.
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVES, 'save_1.2.sav'));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// Map "FirstName LastName" / "FirstName" → records[].
const byFullName = new Map();
for (const r of recs) {
  const k1 = r.lastName ? `${r.firstName} ${r.lastName}` : r.firstName;
  if (!byFullName.has(k1)) byFullName.set(k1, []);
  byFullName.get(k1).push(r);
}
const lookupChar = name => {
  const list = byFullName.get(name) || byFullName.get(name.replace(/\s+/g, " "));
  if (!list || list.length !== 1) return null;
  return list[0];
};

// All known UUIDs (any record), for searching the wife record for cross-references.
const allUuids = new Set();
const uuidToChar = new Map();
for (const r of recs) {
  if (r.primaryUuid) { allUuids.add(r.primaryUuid); uuidToChar.set(r.primaryUuid, r); }
  if (r.secondaryUuid) { allUuids.add(r.secondaryUuid); }
}

// Build per-wife ground truth: husband record, wife age, children records.
const groundTruth = [];
for (const p of pairs) {
  const husbandRec = lookupChar(p.husband);
  if (!husbandRec) continue;
  const wifeAge = charAge.get(p.wife);
  const childRecs = p.children.map(c => lookupChar(c)).filter(Boolean);
  groundTruth.push({
    wifeFirst: p.wife.split(/\s+/)[0],
    wifeAge,
    husband: p.husband,
    husbandRec,
    children: p.children,
    childRecs,
    faction: charFaction.get(p.husband),
  });
}

const wifeNameToIdx = new Map();
for (const gt of groundTruth) {
  const idx = nameToIdx.get(gt.wifeFirst);
  if (idx != null) wifeNameToIdx.set(idx, gt);
}

// Walk markers.
const markers = [];
for (let i = 20000000; i < 24000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}

// Match markers → ground truth via (wifeName@-6, husbandUuid@+40).
const matched = [];
for (const m of markers) {
  const widx = buf.readUInt32LE(m - 6);
  const gt = wifeNameToIdx.get(widx);
  if (!gt) continue;
  const husbandPrim = buf.readUInt32LE(m + 40);
  if (husbandPrim !== gt.husbandRec.primaryUuid) continue;
  matched.push({ marker: m, gt });
}
console.log(`Markers in 20-24M: ${markers.length}, matched-to-groundtruth: ${matched.length}`);

// For each matched wife, scan record window [marker-50, marker+320] for:
//   - wife's age byte (242 - age in regular records; could differ here)
//   - any known UUID that matches the husband, a child, or other related char
//   - child primaryUuid hits
// Then histogram offsets.
const W_LO = -50, W_HI = 360;
const ageOffHist = new Map();         // age @ offset (using 242 - byte)
const ageDirectOffHist = new Map();   // age @ offset (direct byte)
const childOffHist = new Map();       // childPrim @ offset
const husbandSecOffHist = new Map();  // husband.secondaryUuid @ offset
const husbandPrimOffHist = new Map(); // husband.primaryUuid (re-verify)

// Per-record dumps for first 4 matched wives
const dumps = [];
let dumpsLeft = 4;

for (const {marker, gt} of matched) {
  const dump = { marker, wife: gt.wifeFirst, husband: gt.husband, age: gt.wifeAge, children: gt.children, hits: [] };

  for (let o = W_LO; o <= W_HI; o++) {
    const pos = marker + o;
    if (pos < 0 || pos + 4 > buf.length) continue;

    // Age tests
    if (gt.wifeAge != null) {
      const byte = buf[pos];
      if (byte === gt.wifeAge) ageDirectOffHist.set(o, (ageDirectOffHist.get(o)||0) + 1);
      if (byte === (242 - gt.wifeAge) & 0xff) ageOffHist.set(o, (ageOffHist.get(o)||0) + 1);
    }

    // u32 tests
    if (pos + 4 <= buf.length) {
      const v = buf.readUInt32LE(pos);
      if (v === gt.husbandRec.primaryUuid) husbandPrimOffHist.set(o, (husbandPrimOffHist.get(o)||0) + 1);
      if (gt.husbandRec.secondaryUuid && v === gt.husbandRec.secondaryUuid) husbandSecOffHist.set(o, (husbandSecOffHist.get(o)||0) + 1);
      for (const ch of gt.childRecs) {
        if (v === ch.primaryUuid) {
          childOffHist.set(o, (childOffHist.get(o)||0) + 1);
          if (dumpsLeft > 0) dump.hits.push({off: o, kind: 'childPrim', val: v, who: ch.firstName});
        }
        if (ch.secondaryUuid && v === ch.secondaryUuid) {
          if (dumpsLeft > 0) dump.hits.push({off: o, kind: 'childSec', val: v, who: ch.firstName});
        }
      }
    }
  }
  if (dumpsLeft > 0) { dumps.push(dump); dumpsLeft--; }
}

const fmt = (m, total) => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([o,c])=>`${o>=0?'+':''}${o}:${c}(${(100*c/total).toFixed(0)}%)`).join('  ');
const N = matched.length;
console.log(`\n=== HISTOGRAMS (n=${N} matched wives) ===`);
console.log(`Age byte == age direct           : ${fmt(ageDirectOffHist, N)}`);
console.log(`Age byte == 242-age (RTW std)    : ${fmt(ageOffHist, N)}`);
console.log(`u32 == husband.primaryUuid       : ${fmt(husbandPrimOffHist, N)}`);
console.log(`u32 == husband.secondaryUuid     : ${fmt(husbandSecOffHist, N)}`);
console.log(`u32 == child.primaryUuid (any)   : ${fmt(childOffHist, N)}`);

console.log(`\n=== Sample wife record dumps ===`);
for (const d of dumps) {
  console.log(`\n--- ${d.wife} (wife of ${d.husband}, age ${d.age}) @ marker ${d.marker} ---`);
  console.log(`  child UUID hits in window:`);
  for (const h of d.hits) console.log(`    ${h.off>=0?'+':''}${h.off}  ${h.kind}=${h.who} u32=${h.val}`);
  // hex dump marker-12 ... marker+128
  const slab = buf.slice(d.marker - 12, d.marker + 128);
  let line = '';
  for (let i = 0; i < slab.length; i += 16) {
    const off = (i - 12);
    const hex = [...slab.slice(i, i+16)].map(b => b.toString(16).padStart(2,'0')).join(' ');
    line = `   ${off>=0?'+':''}${off.toString().padStart(4)}: ${hex}`;
    console.log(line);
  }
}

// Look for record START (we suspect records are ~364 bytes; markers stride matches that).
// Test: marker - PREV_MARKER for the entire matched sequence. If 364/368 then record likely
// runs marker-K to marker+(364-K), where K = wifeOff offset to record start.
const markerDeltas = new Map();
for (let i = 1; i < markers.length; i++) {
  const d = markers[i] - markers[i-1];
  markerDeltas.set(d, (markerDeltas.get(d)||0) + 1);
}
console.log(`\n=== Marker stride histogram (top 8) ===`);
for (const [d, c] of [...markerDeltas.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8)) {
  console.log(`  delta=${d}: ${c}`);
}
