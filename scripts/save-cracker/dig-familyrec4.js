#!/usr/bin/env node
// dig-familyrec4.js — Session 41 final pass: cross-validate findings on save_1.2
// and Republic Turn 2 save. Verify:
//   - age @ +16  (242 - age) across both saves
//   - husband.primaryUuid @ +40 across both saves
//   - +358 child name idx hit-rate
//   - Look for FATHER UUID at offsets in wife record (some records have nonzero +36)
//
// Also: confirm record boundaries by walking +0..+364 of one record and the
// next 4 bytes — see if there's a sentinel separating records.

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
for (const raw of stratLines) {
  const line = raw.trim();
  let m = line.match(/^character,\s*(?:sub_faction\s+\S+,\s*)?([^,]+?),.*?age\s+(\d+)/);
  if (m) { charAge.set(m[1].trim(), parseInt(m[2],10)); continue; }
  m = line.match(/^character_record\s+(.+?),\s+(male|female),\s+age\s+(\d+)/);
  if (m) charAge.set(m[1].trim(), parseInt(m[3],10));
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

function analyzeSave(saveFile) {
  console.log(`\n=========== ${saveFile} ===========`);
  const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
  const buf = fs.readFileSync(path.join(SAVES, saveFile));
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
  // Search 20-24M for markers
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
  console.log(`Markers: ${markers.length}, matched-by-(wife@-6, husband@+40): ${matched.length}`);

  // Age check
  let ageOk = 0, ageNot = 0;
  for (const {m, gt} of matched) {
    if (gt.wifeAge == null) continue;
    if (buf[m+16] === ((242 - gt.wifeAge) & 0xff)) ageOk++;
    else ageNot++;
  }
  console.log(`age @ +16 == (242 - wifeAge): ${ageOk} OK / ${ageOk+ageNot} testable`);

  // Husband primaryUuid is implicitly 100% (we filter by it)

  // Child @ +358 — first child of wife
  let chOk = 0, chTest = 0;
  for (const {m, gt} of matched) {
    if (!gt.children.length) continue;
    chTest++;
    const v = buf.readUInt16LE(m + 358);
    const childIdxs = new Set(gt.children.map(c => nameToIdx.get(c.split(/\s+/)[0])).filter(x => x != null));
    if (childIdxs.has(v)) chOk++;
  }
  console.log(`+358 u16 matches a known child firstName-idx: ${chOk}/${chTest}`);

  // Try +362 / +356 / +354 for multiple-child slots
  for (const off of [354, 356, 360, 362]) {
    let n = 0, t = 0;
    for (const {m, gt} of matched) {
      if (!gt.children.length) continue;
      t++;
      const v = buf.readUInt16LE(m + off);
      const childIdxs = new Set(gt.children.map(c => nameToIdx.get(c.split(/\s+/)[0])).filter(x => x != null));
      if (childIdxs.has(v)) n++;
    }
    console.log(`+${off} u16: ${n}/${t}`);
  }

  // marker - 7 byte = the byte just before wife name index
  // marker - 1 byte = "alive" flag (per session 39 = 01)
  let aliveByte = new Map();
  for (const {m} of matched) {
    const b = buf[m-1];
    aliveByte.set(b, (aliveByte.get(b)||0) + 1);
  }
  console.log(`marker-1 byte: ${[...aliveByte.entries()].map(([b,c])=>`0x${b.toString(16)}=${c}`).join(', ')}`);

  // Dump the slice from one full record (next-marker - this-marker = 364)
  if (matched.length > 0) {
    const {m, gt} = matched[0];
    console.log(`\n--- Full 368-byte record for ${gt.wifeFirst} (wife of ${gt.husband}) ---`);
    const slab = buf.slice(m - 10, m + 368);
    for (let i = 0; i < slab.length; i += 16) {
      const off = i - 10;
      const hex = [...slab.slice(i, i+16)].map(b => b.toString(16).padStart(2,'0')).join(' ');
      const ascii = [...slab.slice(i, i+16)].map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
      console.log(`  ${off>=0?'+':''}${off.toString().padStart(4)}: ${hex}  ${ascii}`);
    }
  }

  // Are there any nonzero bytes at +250..+357 that might be traits etc?
  const nzByOffset = new Map();
  for (const {m} of matched) {
    for (let o = 250; o < 360; o++) {
      if (buf[m+o] !== 0) nzByOffset.set(o, (nzByOffset.get(o)||0) + 1);
    }
  }
  const nzTop = [...nzByOffset.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
  console.log(`\nNonzero bytes in +250..+360 (top offsets):`);
  for (const [o, c] of nzTop) console.log(`  +${o}: ${c}/${matched.length}`);
  return {markers: markers.length, matched: matched.length};
}

analyzeSave('save_1.2.sav');
analyzeSave('save_Autosave   Republic of Rome   Turn 2 Start.sav');
