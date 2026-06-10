#!/usr/bin/env node
// dig-familyrec2.js — Session 41 attempt 2: pin wife's own primaryUuid + children + faction.
//
// Approach refinements after dig-familyrec1:
//   - age @ marker+16 (242-age) CONFIRMED 83% (rest are non-roman wives w/ name collision)
//   - husband.primaryUuid @ marker+40 CONFIRMED 100%
//   - need: wife's primaryUuid (must be a unique u32 not seen elsewhere)
//   - need: child name idx (likely u16 since children of wife are also in this same table)
//   - look at marker-12 .. marker+360 (full record) — record stride is 364
//
// New strategy for wife's UUID:
//   For each matched wife, scan record for any u32 that is in allUuids set
//   AND not the husband's. If a u32 appears at one stable offset across
//   wives that is otherwise zeroed, it's likely the secondaryUuid.
//   Wife's PRIMARY UUID may be unique-but-not-in-allUuids (allUuids only
//   contains primary chars; wives aren't in it).
//
// New strategy for wife's primaryUuid:
//   The wife's primaryUuid is unknown. But session 39 found gender=1 family
//   records also store sons. A son's record has +40 = father's primaryUuid.
//   If we find another wife OR child whose +40 == THIS wife's some-offset-u32,
//   that some-offset-u32 IS the wife's primaryUuid.
//
//   Translation: for each marker M_a, scan its bytes; for each u32 V at off O,
//   check if V appears at marker+40 in ANY OTHER family record (i.e. V is some-
//   one's "parent uuid"). If yes, V is likely a primary uuid of some character.
//   If that character is THIS wife, we've found wifeSelfUuid at offset O.

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

const wifeNameToGTs = new Map();  // wifeNameIdx → [gt...]
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

// Collect all "parent-uuid-at-+40" values used in family records.
const parentUuidsInRec = new Set();
for (const m of markers) {
  const v = buf.readUInt32LE(m + 40);
  if (v) parentUuidsInRec.add(v);
}

// Collect ALL u32 values at every offset across all family records, to find
// columns where the same value (or kind of value) sits.
const colValuesPerOffset = new Map(); // offset → Map(value → count)
const W_LO = -12, W_HI = 350;
for (const m of markers) {
  for (let o = W_LO; o <= W_HI - 4; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    if (!colValuesPerOffset.has(o)) colValuesPerOffset.set(o, new Map());
    const sub = colValuesPerOffset.get(o);
    sub.set(v, (sub.get(v)||0) + 1);
  }
}

// For known-uuid hits: scan each wife record for u32 that is (a) the husband-uuid
// of SOME other family record marker (b) not zero (c) the wife name being looked up.
// Build histogram per offset of "this u32 V is found at marker+40 of some other marker".
const wifeSelfHist = new Map();
const sampleSelfUuid = {};
let matchedCount = 0;
const matched = [];
for (const m of markers) {
  const widx = buf.readUInt32LE(m - 6);
  if (!wifeNameToGTs.has(widx)) continue;
  const hpUuid = buf.readUInt32LE(m + 40);
  // pick the gt with the matching husband
  const gt = wifeNameToGTs.get(widx).find(g => g.husbandRec.primaryUuid === hpUuid);
  if (!gt) continue;
  matched.push({m, gt});
  matchedCount++;
  for (let o = W_LO; o <= W_HI - 4; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    if (v === 0 || v === 0xffffffff) continue;
    if (parentUuidsInRec.has(v) && v !== gt.husbandRec.primaryUuid) {
      // Promising — this u32 is someone's parent. Could be wife herself.
      wifeSelfHist.set(o, (wifeSelfHist.get(o)||0) + 1);
      if (!sampleSelfUuid[o]) sampleSelfUuid[o] = [];
      if (sampleSelfUuid[o].length < 3) sampleSelfUuid[o].push({wife: gt.wifeFirst, val: v});
    }
  }
}

console.log(`Matched wives: ${matchedCount}`);
console.log(`\n=== Possible wifeSelfUuid offsets (u32 at offset is parent-uuid in some other family record) ===`);
const sortedSelf = [...wifeSelfHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
for (const [o, c] of sortedSelf) {
  const pct = (100*c/matchedCount).toFixed(0);
  const samples = (sampleSelfUuid[o]||[]).map(s => `${s.wife}=${s.val}`).join(', ');
  console.log(`  ${o>=0?'+':''}${o}: ${c} (${pct}%) — samples: ${samples}`);
}

// What's at each column across all 361 records? Top column value if same in many records
// = a constant. Variable = a per-record field.
console.log(`\n=== Column entropy summary (every 4 bytes from -12 to +120) ===`);
console.log(`offset  uniqueValues  mostCommon=count  isMostlyConstant?`);
for (let o = W_LO; o <= 120; o += 4) {
  const sub = colValuesPerOffset.get(o);
  if (!sub) continue;
  const total = [...sub.values()].reduce((a,b)=>a+b, 0);
  const top = [...sub.entries()].sort((a,b)=>b[1]-a[1])[0];
  const pct = (100*top[1]/total).toFixed(0);
  const hex = top[0].toString(16).padStart(8,'0');
  const flag = top[1] >= total*0.5 ? 'CONST' : 'VAR';
  console.log(`  ${o>=0?'+':''}${o.toString().padStart(4)}  unique=${sub.size.toString().padStart(4)}  top=0x${hex} ×${top[1]}/${total} (${pct}%)  ${flag}`);
}

// Check word at +18 (saw c0 fe ff ff = signed -316?) — likely turn-of-birth.
console.log(`\n=== Spot offsets across first 8 matched wives ===`);
console.log(`  wife            age  +16(byte)  +18(s16/i16)  +20(u32)  +44(u32)  +68(u32)  +80(u32)  +88(u32)`);
for (const {m, gt} of matched.slice(0, 8)) {
  const age = 242 - buf[m+16];
  const s18 = buf.readInt16LE(m+18);
  const u20 = buf.readUInt32LE(m+20);
  const u44 = buf.readUInt32LE(m+44);
  const u68 = buf.readUInt32LE(m+68);
  const u80 = buf.readUInt32LE(m+80);
  const u88 = buf.readUInt32LE(m+88);
  console.log(`  ${gt.wifeFirst.padEnd(15)} ${age.toString().padStart(3)}  ${buf[m+16].toString(16).padStart(2,'0')}        ${s18.toString().padStart(6)}        0x${u20.toString(16).padStart(8,'0')}  0x${u44.toString(16).padStart(8,'0')}  0x${u68.toString(16).padStart(8,'0')}  0x${u80.toString(16).padStart(8,'0')}  0x${u88.toString(16).padStart(8,'0')}`);
}

// Test +44 as the wife's own primaryUuid: across ALL matched wives, does +44 ever equal
// the parent-uuid of some other family record (i.e. wife is the mother of a child record)?
console.log(`\n=== Test: wife's own primaryUuid candidates ===`);
const candidates = [44, 48, 52, 56, 60, 64, 80, 84, 88];
for (const o of candidates) {
  let hitsAsParentOfChild = 0;
  let allDifferent = new Set();
  let zeroCount = 0;
  for (const {m, gt} of matched) {
    const v = buf.readUInt32LE(m + o);
    if (v === 0) zeroCount++;
    allDifferent.add(v);
    if (parentUuidsInRec.has(v) && v !== gt.husbandRec.primaryUuid) hitsAsParentOfChild++;
  }
  console.log(`  +${o}: ${allDifferent.size} unique / ${matched.length} records, zeros=${zeroCount}, hits-as-parent-of-someone=${hitsAsParentOfChild}`);
}

// Search marker-12..marker+360 for any name index (u16 or u32) that matches a known child name.
console.log(`\n=== Child name-index scan (u16 little-endian) ===`);
const childOffHist = new Map();
let totalWifesWithChildren = 0;
for (const {m, gt} of matched) {
  if (!gt.children.length) continue;
  totalWifesWithChildren++;
  const wantedIdxs = new Set();
  for (const c of gt.children) {
    const first = c.split(/\s+/)[0];
    const idx = nameToIdx.get(first);
    if (idx != null) wantedIdxs.add(idx);
  }
  if (!wantedIdxs.size) continue;
  for (let o = -16; o <= 360; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 2 > buf.length) continue;
    const v = buf.readUInt16LE(pos);
    if (wantedIdxs.has(v)) {
      childOffHist.set(o, (childOffHist.get(o)||0) + 1);
    }
  }
}
console.log(`Wives with children in groundtruth: ${totalWifesWithChildren}`);
const sortedChild = [...childOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12);
for (const [o, c] of sortedChild) {
  console.log(`  ${o>=0?'+':''}${o}: ${c} (${(100*c/totalWifesWithChildren).toFixed(0)}%)`);
}

// Factions: descr_sm_factions ordering should map to integer ids 0..N
console.log(`\n=== Faction-id scan (u8 / u16 / u32 at each offset) ===`);
const factionOrder = [];
{
  const fs2 = fs.readFileSync(path.join("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt"), "utf8");
  let inF = false;
  for (const raw of fs2.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^playable/i.test(line)) inF = true;
    if (inF && /^[a-z_]+$/.test(line) && !line.startsWith("end")) factionOrder.push(line);
    if (/^end/i.test(line)) inF = false;
  }
}
// build {wife → faction index by descr_strat order}
const factionIndex = new Map();
factionOrder.forEach((f, i) => factionIndex.set(f, i));
const factionAtOffHist = new Map();
let factTotal = 0;
for (const {m, gt} of matched) {
  const fi = factionIndex.get(gt.faction);
  if (fi == null) continue;
  factTotal++;
  for (let o = -16; o <= 360; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 1 > buf.length) continue;
    if (buf[pos] === fi) {
      const key = `${o}:u8`;
      factionAtOffHist.set(key, (factionAtOffHist.get(key)||0) + 1);
    }
  }
}
console.log(`Wives with faction in playable list: ${factTotal}`);
for (const [k, c] of [...factionAtOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 8)) {
  console.log(`  ${k}: ${c} (${(100*c/factTotal).toFixed(0)}%)`);
}
