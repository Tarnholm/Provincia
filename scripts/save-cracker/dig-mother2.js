#!/usr/bin/env node
// dig-mother2.js — Session 89 attempt 2.
//
// Attempt 1 only resolved 15 GT tuples via descr_strat lookup. This attempt
// builds ground truth purely from the save data:
//   - Each wife record at marker M has husband uuid at M+40 and wife
//     firstName-idx at M-6.
//   - In RTW marriage is monogamous → every child whose fatherUuid ==
//     husband.primaryUuid has THIS wife as his/her mother.
// That gives us hundreds of (mother, child) pairs to test offset hypotheses
// at high confidence.
//
// Hypotheses to test (same as attempt 1, with broader pool):
//   H1: child record carries a u16 == mother.firstName-idx (somewhere).
//   H2: wife record carries a u32 == child.primaryUuid (somewhere).
//   H3: wife record carries a u16 == child.firstName-idx (somewhere).
//   H4: child record carries a u32 == wife.marker+36 (her "father uuid"
//       slot — i.e. mother's family origin propagates to children).
//   H5: child record carries u32 == wife record OFFSET / position id.
//   H6: NOT TRACKED — no offset survives broad cross-checking → result is
//       "engine doesn't store mother→child explicitly; sons inherit via
//       father only; wife is rendered into the family tree by being a
//       relation of the father."
//
// Also: only consider children whose record-trait Factionheir / +18 clanHead
// is NOT 0xffffffff in case the linkage is a "clan head" pointer.

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
const recByUuid = new Map();
for (const r of recs) if (r.primaryUuid) recByUuid.set(r.primaryUuid, r);
const recsByFather = new Map();
for (const r of recs) {
  if (!r.fatherUuid) continue;
  if (!recsByFather.has(r.fatherUuid)) recsByFather.set(r.fatherUuid, []);
  recsByFather.get(r.fatherUuid).push(r);
}

// Find wife markers
const markers = [];
for (let i = 20000000; i < 24000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}

// Build (mother, child) pairs: for each wife marker with valid husband uuid,
// pull every child whose fatherUuid == husbandUuid.
const pairs = []; // { wifeMarker, wifeFirstIdx, husbandUuid, childRec }
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
      husbandRec: recByUuid.get(hu),
    });
  }
}
console.log(`Save-derived (mother, child) pairs: ${pairs.length}`);
console.log(`  ... covering ${new Set(pairs.map(p=>p.wifeMarker)).size} distinct wife markers`);
console.log(`  ... and ${new Set(pairs.map(p=>p.childRec.primaryUuid)).size} distinct children`);

const N = pairs.length;
if (!N) { console.log('No pairs — abort'); process.exit(0); }

// === SCAN H1: child record u16 == mother.firstNameIdx (any offset -20..+450) ===
console.log(`\n=== H1: child record u16 == mother.firstNameIdx ===`);
const h1 = new Map();
for (const p of pairs) {
  const cOff = p.childRec.offset;
  for (let o = -20; o <= 450; o++) {
    const pos = cOff + o;
    if (pos < 0 || pos + 2 > buf.length) continue;
    if (buf.readUInt16LE(pos) === p.wifeFirstIdx) h1.set(o, (h1.get(o)||0) + 1);
  }
}
for (const [o, c] of [...h1.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) {
  console.log(`  child${o>=0?'+':''}${o}: ${c}/${N} (${(100*c/N).toFixed(0)}%)`);
}

// === SCAN H1b: child record u32 == mother.firstNameIdx ===
console.log(`\n=== H1b: child record u32 == mother.firstNameIdx ===`);
const h1b = new Map();
for (const p of pairs) {
  const cOff = p.childRec.offset;
  for (let o = -20; o <= 450 - 4; o++) {
    const pos = cOff + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    if (buf.readUInt32LE(pos) === p.wifeFirstIdx) h1b.set(o, (h1b.get(o)||0) + 1);
  }
}
for (const [o, c] of [...h1b.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) {
  console.log(`  child${o>=0?'+':''}${o}: ${c}/${N} (${(100*c/N).toFixed(0)}%)`);
}

// === SCAN H2: wife record u32 == child.primaryUuid (any offset -50..+380) ===
console.log(`\n=== H2: wife record u32 == child.primaryUuid ===`);
const h2 = new Map();
const h2sample = new Map();
for (const p of pairs) {
  const cu = p.childRec.primaryUuid;
  if (!cu) continue;
  const m = p.wifeMarker;
  for (let o = -50; o <= 380 - 4; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    if (buf.readUInt32LE(pos) === cu) {
      h2.set(o, (h2.get(o)||0) + 1);
      if (!h2sample.has(o)) h2sample.set(o, []);
      if (h2sample.get(o).length < 3) {
        h2sample.get(o).push(`${nameLookup[p.wifeFirstIdx]}@${m}→${p.childRec.firstName}`);
      }
    }
  }
}
for (const [o, c] of [...h2.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 14)) {
  const s = (h2sample.get(o)||[]).join('; ');
  console.log(`  wife${o>=0?'+':''}${o}: ${c}/${N} (${(100*c/N).toFixed(0)}%) ex: ${s}`);
}

// === SCAN H3: wife record u16 == child.firstName-idx (any offset -20..+380) ===
console.log(`\n=== H3: wife record u16 == child.firstName-idx ===`);
const h3 = new Map();
for (const p of pairs) {
  const cn = p.childRec.firstName;
  const cidx = nameToIdx.get(cn);
  if (cidx == null) continue;
  const m = p.wifeMarker;
  for (let o = -20; o <= 380; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 2 > buf.length) continue;
    if (buf.readUInt16LE(pos) === cidx) h3.set(o, (h3.get(o)||0) + 1);
  }
}
for (const [o, c] of [...h3.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) {
  console.log(`  wife${o>=0?'+':''}${o}: ${c}/${N} (${(100*c/N).toFixed(0)}%)`);
}

// === SCAN H4: child record u32 == wife.marker+36 value ===
console.log(`\n=== H4: child record u32 == wife.marker+36 (mother's father-uuid candidate) ===`);
const h4 = new Map();
for (const p of pairs) {
  const wf36 = buf.readUInt32LE(p.wifeMarker + 36);
  if (!wf36) continue;
  const cOff = p.childRec.offset;
  for (let o = -20; o <= 450 - 4; o++) {
    const pos = cOff + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    if (buf.readUInt32LE(pos) === wf36) h4.set(o, (h4.get(o)||0) + 1);
  }
}
const N_h4 = pairs.filter(p => buf.readUInt32LE(p.wifeMarker + 36) !== 0).length;
console.log(`  (denominator with nonzero wife+36: ${N_h4})`);
for (const [o, c] of [...h4.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 12)) {
  console.log(`  child${o>=0?'+':''}${o}: ${c}/${N_h4} (${(100*c/N_h4).toFixed(0)}%)`);
}

// === SCAN H5: child record u32 == wife marker offset ===
console.log(`\n=== H5: child record u32 == wife marker file offset ===`);
const h5 = new Map();
for (const p of pairs) {
  const wm = p.wifeMarker;
  const cOff = p.childRec.offset;
  for (let o = -20; o <= 450 - 4; o++) {
    const pos = cOff + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    if (buf.readUInt32LE(pos) === wm) h5.set(o, (h5.get(o)||0) + 1);
  }
}
for (const [o, c] of [...h5.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 8)) {
  console.log(`  child${o>=0?'+':''}${o}: ${c}/${N} (${(100*c/N).toFixed(0)}%)`);
}

// === BONUS: how many children have NON-DEFAULT (non-0xffffffff) clanHead at +18? Maybe wife? ===
console.log(`\n=== clanHead @ +18: distribution among children with mother ===`);
let withClan = 0, clanIsMother = 0;
for (const p of pairs) {
  const cOff = p.childRec.offset;
  if (cOff + 22 > buf.length) continue;
  const idx = buf.readUInt32LE(cOff + 18);
  if (idx !== 0xffffffff) {
    withClan++;
    if (idx === p.wifeFirstIdx) clanIsMother++;
  }
}
console.log(`  children with clanHead !=ff: ${withClan}/${N}; matches mother name idx: ${clanIsMother}`);

// === H_strict: scan FOR A FIXED OFFSET — i.e. require >= 70% hit ===
console.log(`\n=== Strict screen: any offset hitting >= 50%? ===`);
const all = [
  ['H1 child u16=motherName', h1, N],
  ['H1b child u32=motherName', h1b, N],
  ['H2 wife u32=childUuid', h2, pairs.filter(p=>p.childRec.primaryUuid).length],
  ['H3 wife u16=childName', h3, pairs.filter(p=>nameToIdx.has(p.childRec.firstName)).length],
  ['H4 child u32=wife+36', h4, N_h4],
  ['H5 child u32=wifeOffset', h5, N],
];
for (const [name, hist, denom] of all) {
  let best = ['none', 0];
  for (const [o, c] of hist) if (c > best[1]) best = [o, c];
  console.log(`  ${name.padEnd(28)} best off=${best[0]} hit=${best[1]}/${denom} (${(100*best[1]/denom).toFixed(0)}%)`);
}

// === Investigate: do siblings share a u32 at any fixed offset (the "mother field")? ===
console.log(`\n=== Sibling concordance: do children of same mother share a u32 at fixed offset? ===`);
// Group by wifeMarker, only mothers with >=2 children
const byWife = new Map();
for (const p of pairs) {
  if (!byWife.has(p.wifeMarker)) byWife.set(p.wifeMarker, []);
  byWife.get(p.wifeMarker).push(p);
}
const multi = [...byWife.entries()].filter(([m, kids]) => kids.length >= 2);
console.log(`  Mothers with >=2 children: ${multi.length}`);

// For each offset 0..450, count how many sibling-groups share the same u32
const sharedOffHist = new Map();
const distinctOffHist = new Map();
for (let o = -20; o <= 450 - 4; o++) {
  let shared = 0, total = 0;
  for (const [m, kids] of multi) {
    total++;
    const vals = new Set();
    let allValid = true;
    for (const k of kids) {
      const pos = k.childRec.offset + o;
      if (pos < 0 || pos + 4 > buf.length) { allValid = false; break; }
      vals.add(buf.readUInt32LE(pos));
    }
    if (allValid && vals.size === 1) shared++;
  }
  sharedOffHist.set(o, shared);
  distinctOffHist.set(o, total);
}
// Find offsets with high concordance (excluding fatherUuid which we already know)
console.log(`  Top offsets where ALL siblings share a u32:`);
const knownChildOff = new Set([5, 46]); // first u32 of lastName + fatherUuid
for (const [o, s] of [...sharedOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 25)) {
  const t = distinctOffHist.get(o);
  // Also check that the shared value VARIES per sibling group (else it's just a constant byte)
  const groupVals = new Set();
  for (const [m, kids] of multi) {
    const pos = kids[0].childRec.offset + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    groupVals.add(buf.readUInt32LE(pos));
  }
  const annot = knownChildOff.has(o) ? ' [known: lastName/fatherUuid]' : '';
  console.log(`  child${o>=0?'+':''}${o}: ${s}/${t} sibling-groups share (${(100*s/t).toFixed(0)}%), distinct-vals=${groupVals.size}${annot}`);
}

// Print a sample sibling group with values around an interesting offset
console.log(`\n=== Sibling sample (children of same mother): values at key offsets ===`);
for (const [m, kids] of multi.slice(0, 3)) {
  console.log(`Mother @${m} (${nameLookup[buf.readUInt32LE(m-6)]}), husband uuid=${kids[0].husbandUuid}`);
  for (const k of kids) {
    const c = k.childRec;
    const o18 = buf.readUInt32LE(c.offset + 18);
    const o22 = buf.readUInt32LE(c.offset + 22);
    const o42 = buf.readUInt32LE(c.offset + 42);
    const o46 = buf.readUInt32LE(c.offset + 46);
    const o50 = buf.readUInt32LE(c.offset + 50);
    console.log(`  ${c.firstName.padEnd(15)} uuid=${c.primaryUuid} +18=${o18} +22=${o22} +42=${o42} +46(fatherUuid)=${o46} +50=${o50}`);
  }
}
