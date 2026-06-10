#!/usr/bin/env node
// dig-mother3.js — Session 89 attempt 3 (final).
//
// Attempt 2 revealed a critical clue: Greek family Thessalonike has three
// sons (PhilipposD, AlexandrosE, AntipatrosB). All three share +42 ==
// husband.primaryUuid (LAYOUT_B fatherUuid), but their +46 values differ:
// 0, 953338676, 1218761072.
//
// LAYOUT_B fields shift -4 vs LAYOUT_A. So in LAYOUT_B:
//   +42 = fatherUuid (CONFIRMED)
//   +46 = ??? (a 4-byte slot RIGHT AFTER fatherUuid)
//
// In LAYOUT_A:
//   +46 = fatherUuid (CONFIRMED)
//   +50 = ??? (a 4-byte slot RIGHT AFTER fatherUuid)
//
// HYPOTHESIS for FINAL test: the SLOT IMMEDIATELY AFTER fatherUuid is the
// MOTHER POINTER (or wife-marker reference). Test:
//   - For LAYOUT_A child: check +50 value
//   - For LAYOUT_B child: check +46 value
// against:
//   (a) wife marker offset (file position)
//   (b) wife marker - 6 (wife firstNameIdx)
//   (c) any byte pattern that distinguishes mothers
//
// But: childUuids slots are at LAYOUT_A +54..+66 / LAYOUT_B +50..+62. So
// the "next slot" candidate IS the start of the childUuids array in our
// existing parser — but only for the PARENT, not for children themselves.
//
// In a child's record, what lives just after fatherUuid (LAYOUT_A +50,
// LAYOUT_B +46)? The childUuids array (their own children). Hmm but child
// is too young to have children themselves… so that field should be 0
// for them. But we see varying values. So it's NOT the childUuids array
// for these young children — could it be the mother slot REUSING that
// space?
//
// We're not looking for layouts here — we'll just use the parser's
// layoutB-aware offset table.

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

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVES, 'save_1.2.sav'));
const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);

// We need each record's layoutB classification — re-determine by checking
// where fatherUuid actually lives. parser only exposes fatherUuid value;
// we need to know which offset that came from. Trick: re-derive by
// matching fatherUuid back to one of the two candidate positions.
function layoutOfRec(r) {
  if (r.lastName == null) return 'B';
  return 'A';
}

const recByUuid = new Map();
for (const r of recs) if (r.primaryUuid) recByUuid.set(r.primaryUuid, r);
const recsByFather = new Map();
for (const r of recs) {
  if (!r.fatherUuid) continue;
  if (!recsByFather.has(r.fatherUuid)) recsByFather.set(r.fatherUuid, []);
  recsByFather.get(r.fatherUuid).push(r);
}

const markers = [];
for (let i = 20000000; i < 24000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}

const pairs = [];
for (const m of markers) {
  const widx = buf.readUInt32LE(m - 6);
  if (widx === 0 || widx >= nameLookup.length || !nameLookup[widx]) continue;
  const hu = buf.readUInt32LE(m + 40);
  if (!hu || !recByUuid.has(hu)) continue;
  const kids = recsByFather.get(hu) || [];
  for (const k of kids) {
    pairs.push({
      wifeMarker: m,
      wifeFirstIdx: widx,
      husbandUuid: hu,
      childRec: k,
      childLayout: layoutOfRec(k),
    });
  }
}
console.log(`Save-derived (mother, child) pairs: ${pairs.length}`);
const N = pairs.length;
if (!N) process.exit(0);

// === SCAN 1: post-father slot — test every possible target value the slot might hold ===
// LAYOUT_A post-father starts at +50. LAYOUT_B post-father starts at +46.
function postFather(c) {
  const o = c.childLayout === 'A' ? 50 : 46;
  if (c.childRec.offset + o + 4 > buf.length) return null;
  return buf.readUInt32LE(c.childRec.offset + o);
}
function preNameIdx(c) {
  // u16 at -2 of post-father, or +14 of the slot…
  return null;
}

console.log(`\n=== Test 1: post-fatherUuid slot (A+50/B+46) value distribution ===`);
let nonZero = 0, eqHusband = 0, eqWifeMarker = 0, eqWifeIdx = 0;
const sample = [];
for (const p of pairs) {
  const v = postFather(p);
  if (v == null) continue;
  if (v !== 0) nonZero++;
  if (v === p.husbandUuid) eqHusband++;
  if (v === p.wifeMarker) eqWifeMarker++;
  if (v === p.wifeFirstIdx) eqWifeIdx++;
  if (sample.length < 12) sample.push(`  ${p.childRec.firstName.padEnd(15)} layout=${p.childLayout} fatherUuid=${p.childRec.fatherUuid} postFather=${v} wife=${nameLookup[p.wifeFirstIdx]}@${p.wifeMarker}`);
}
console.log(`  nonZero: ${nonZero}/${N}`);
console.log(`  == husbandUuid: ${eqHusband}/${N}`);
console.log(`  == wifeMarker offset: ${eqWifeMarker}/${N}`);
console.log(`  == wifeFirstNameIdx: ${eqWifeIdx}/${N}`);
sample.forEach(s => console.log(s));

// === SCAN 2: does the post-father slot value appear ANYWHERE in the wife record? ===
console.log(`\n=== Test 2: post-fatherUuid slot value found in WIFE record window? ===`);
const off2hist = new Map();
let testable = 0;
for (const p of pairs) {
  const v = postFather(p);
  if (v == null || v === 0) continue;
  testable++;
  const m = p.wifeMarker;
  for (let o = -50; o <= 380 - 4; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    if (buf.readUInt32LE(pos) === v) off2hist.set(o, (off2hist.get(o)||0) + 1);
  }
}
console.log(`  testable (nonzero post-father): ${testable}`);
for (const [o, c] of [...off2hist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10)) {
  console.log(`  wife${o>=0?'+':''}${o}: ${c}/${testable} (${(100*c/testable).toFixed(0)}%)`);
}

// === SCAN 3: maybe motherhood is encoded in the WIFE-RECORD as a list of child UUIDs.
// Scan wife body for child UUIDs of THIS wife (we already did this — 11% at +311 was noise).
// Let's verify +311 is real or coincidence by counting whether +311 hits ANY child's primaryUuid
// for the SAME mother, OR a RANDOM child of a different mother.
console.log(`\n=== Test 3: control — does wife+311 match RANDOM child UUIDs at the same rate? ===`);
let realHits = 0, controlHits = 0, totReal = 0, totCtrl = 0;
const allChildUuids = [...new Set(pairs.map(p => p.childRec.primaryUuid).filter(Boolean))];
for (const p of pairs) {
  const v311 = buf.readUInt32LE(p.wifeMarker + 311);
  if (p.childRec.primaryUuid) {
    totReal++;
    if (v311 === p.childRec.primaryUuid) realHits++;
    // pick a random other child not of this mother
    const others = allChildUuids.filter(u => u !== p.childRec.primaryUuid);
    const randU = others[Math.floor(Math.random() * others.length)];
    totCtrl++;
    if (v311 === randU) controlHits++;
  }
}
console.log(`  +311 real-child match: ${realHits}/${totReal}`);
console.log(`  +311 random-control match: ${controlHits}/${totCtrl}`);

// === SCAN 4: Roman case — Baebiana's two sons share fatherUuid (+46 in LAYOUT_A).
// Look at +50, +66, +70, +74 — slots after the 4 childUuid slots — what's there?
console.log(`\n=== Test 4: LAYOUT_A roman child record dump at offsets 40..80 ===`);
const romanKids = pairs.filter(p => p.childLayout === 'A');
console.log(`  Roman (LAYOUT_A) child count: ${romanKids.length}`);
const dumpedMothers = new Set();
for (const p of romanKids) {
  if (dumpedMothers.has(p.wifeMarker)) continue;
  const sibs = romanKids.filter(q => q.wifeMarker === p.wifeMarker);
  if (sibs.length < 2) continue;
  dumpedMothers.add(p.wifeMarker);
  console.log(`Mother @${p.wifeMarker} (${nameLookup[p.wifeFirstIdx]}) husbandUuid=${p.husbandUuid}`);
  for (const s of sibs) {
    const c = s.childRec;
    const parts = [];
    for (let o = 40; o <= 80; o += 4) {
      parts.push(`+${o}=${buf.readUInt32LE(c.offset + o)}`);
    }
    console.log(`  ${c.firstName} ${c.lastName||''} ${parts.join(' ')}`);
  }
  if (dumpedMothers.size >= 3) break;
}

// === SCAN 5: maybe the mother slot is OUTSIDE the record — pre-record. Each char record's
// primaryUuid sits at -47 (LAYOUT_A) / -43 (LAYOUT_B). What's at -39 / -35 etc?
console.log(`\n=== Test 5: pre-record bytes for siblings — look for shared u32 ===`);
const sibGroups = [...new Map(pairs.map(p => [p.wifeMarker, []])).keys()]
  .map(wm => ({ wm, kids: pairs.filter(p => p.wifeMarker === wm) }))
  .filter(g => g.kids.length >= 2);
console.log(`  Sibling groups (>=2 kids): ${sibGroups.length}`);
// Scan -100..0 of child record for u32 shared across siblings
const preHist = new Map();
const preDistinct = new Map();
for (let o = -100; o <= -1; o++) {
  let shared = 0;
  let distinctVals = new Set();
  for (const g of sibGroups) {
    const vals = new Set();
    let ok = true;
    for (const k of g.kids) {
      const pos = k.childRec.offset + o;
      if (pos < 0 || pos + 4 > buf.length) { ok = false; break; }
      vals.add(buf.readUInt32LE(pos));
    }
    if (ok && vals.size === 1) {
      shared++;
      distinctVals.add([...vals][0]);
    }
  }
  if (shared >= 2) {
    preHist.set(o, shared);
    preDistinct.set(o, distinctVals.size);
  }
}
console.log(`  pre-record offsets where siblings share AND vary per group:`);
for (const [o, c] of [...preHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10)) {
  console.log(`  child${o}: ${c}/${sibGroups.length} groups share, ${preDistinct.get(o)} distinct group-values`);
}

// === FINAL SUMMARY ===
console.log(`\n=== FINAL: best mother-link offset >= 70%? ===`);
const all = [
  ['Test1 postFather==husband', eqHusband, N],
  ['Test1 postFather==wifeMarker', eqWifeMarker, N],
  ['Test1 postFather==wifeFirstIdx', eqWifeIdx, N],
];
for (const [name, hits, denom] of all) {
  console.log(`  ${name.padEnd(34)} ${hits}/${denom} (${(100*hits/denom).toFixed(0)}%)`);
}
