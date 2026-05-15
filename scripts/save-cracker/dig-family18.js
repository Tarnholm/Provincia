#!/usr/bin/env node
// dig-family18.js — align family records by marker position, then identify
// firstName position dynamically.
//
// For each marker pos in 21.5M-23M, look back -50..0 bytes for a u32
// matching a "known wife name idx". Then catalog the offset.

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

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVES, 'save_1.2.sav'));

const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
const byFirstLast = new Map();
const byFirst = new Map();
for (const r of recs) {
  const key = `${r.firstName}|${r.lastName||''}`;
  if (!byFirstLast.has(key)) byFirstLast.set(key, []);
  byFirstLast.get(key).push(r);
  if (!byFirst.has(r.firstName)) byFirst.set(r.firstName, []);
  byFirst.get(r.firstName).push(r);
}

// Parse relative lines: head, wife, [children...]
const strat = fs.readFileSync("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt", "utf8");
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

// Collect set of known wife name indexes
const knownWifeIdxs = new Set();
for (const p of pairs) {
  const idx = nameToIdx.get(p.wifeFirst);
  if (idx != null) knownWifeIdxs.add(idx);
}
console.log(`Known wife name indexes: ${knownWifeIdxs.size}`);

// For each marker, look at u32 values at offsets -16 .. +2 (from marker) to
// find one that matches a known wife idx. Record the offset.
const markers = [];
for (let i = 21500000; i < 23000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}
console.log(`Markers: ${markers.length}`);

const offsetHist = new Map();
let foundCount = 0;
for (const m of markers) {
  for (let o = -16; o <= 0; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    if (knownWifeIdxs.has(v)) {
      offsetHist.set(o, (offsetHist.get(o)||0)+1);
      foundCount++;
      break;
    }
  }
}
console.log(`Markers with a known-wife name idx within -16..0 of marker: ${foundCount}`);
console.log(`Offset histogram (relative to marker):`);
for (const [o, c] of [...offsetHist.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  marker${o>=0?'+':''}${o}: ${c}`);
}

// Now: for each marker where we find a wife, decode wife and try to find
// husband pointer in the wife record.
const wifeFinds = [];
for (const m of markers) {
  let wifeIdx = -1, wifeOffsetFromMarker = 0;
  for (let o = -16; o <= 0; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    if (knownWifeIdxs.has(v)) { wifeIdx = v; wifeOffsetFromMarker = o; break; }
  }
  if (wifeIdx < 0) continue;
  const wifeName = nameLookup[wifeIdx];
  // Find pair entry
  const candidates = pairs.filter(p => p.wifeFirst === wifeName);
  // husband determined by matching parsed husband by firstName+lastName uniqueness
  for (const p of candidates) {
    const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
    const husbands = byFirstLast.get(husbandKey);
    if (!husbands || husbands.length !== 1) continue;
    const h = husbands[0];
    wifeFinds.push({ marker: m, wifeOffsetFromMarker, wifeIdx, wifeName, husband: h, pair: p });
    break; // first matched husband per marker
  }
}
console.log(`\nWife-husband pairs successfully cross-referenced: ${wifeFinds.length}`);

// 1) Husband-uuid hits in wife record:
const offsetHistH = new Map(); // (markerRelOffset_type) -> count
const examples = [];
for (const wf of wifeFinds) {
  // Wife record spans approx marker-50 .. marker+300. Scan u32 at marker-50..+300.
  for (let i = -50; i <= 300; i++) {
    const pos = wf.marker + i;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    let tag = null;
    if (v === wf.husband.primaryUuid) tag = 'primary';
    else if (v === wf.husband.secondaryUuid) tag = 'secondary';
    else if (v === wf.husband.offset) tag = 'recOffset';
    if (tag) {
      const key = `marker${i>=0?'+':''}${i}_${tag}`;
      offsetHistH.set(key, (offsetHistH.get(key)||0)+1);
      examples.push({ wife: wf.wifeName, husband: `${wf.pair.husbandFirst} ${wf.pair.husbandLast||''}`, key });
    }
  }
}
console.log(`\nHusband-uuid offsets within wife record:`);
for (const [k, c] of [...offsetHistH.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30)) {
  console.log(`  ${k}: ${c}`);
}
console.log(`\nFirst 12 examples:`);
for (const e of examples.slice(0, 12)) {
  console.log(`  ${e.husband} <-> ${e.wife}: ${e.key}`);
}

// 2) Try husband record pointing to wife: search husband record for u32 values
//    that match (a) the wife name idx, (b) wife marker pos, (c) wife rec start
console.log(`\n--- Husband record -> wife pointer scan ---`);
const offsetHistW = new Map();
for (const wf of wifeFinds) {
  const wifeRefs = [
    { val: wf.wifeIdx, tag: 'wifeNameIdx' },
    { val: wf.marker, tag: 'wifeMarkerAbs' },
    { val: wf.marker - 14, tag: 'wifeRecStartAbs' },
  ];
  // Also try u32s at various wife record positions as "wife primaryUuid"
  for (let wo = -50; wo <= 200; wo += 4) {
    const wp = wf.marker + wo;
    if (wp < 0 || wp + 4 > buf.length) continue;
    const wv = buf.readUInt32LE(wp);
    if (wv > 1000 && wv !== 0xffffffff && wv !== wf.husband.primaryUuid && wv !== wf.husband.secondaryUuid) {
      wifeRefs.push({ val: wv, tag: `wifeMarker${wo>=0?'+':''}${wo}` });
    }
  }
  // Scan husband record window
  for (let i = -50; i <= 300; i++) {
    const pos = wf.husband.offset + i;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    for (const wr of wifeRefs) {
      if (v === wr.val) {
        const key = `husband${i>=0?'+':''}${i}_${wr.tag}`;
        offsetHistW.set(key, (offsetHistW.get(key)||0)+1);
      }
    }
  }
}
console.log(`Husband-record hits referring to wife (top 30 across all wifeFinds):`);
for (const [k, c] of [...offsetHistW.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30)) {
  console.log(`  ${k}: ${c}`);
}

// Filter to entries that mention "wifeMarker" (i.e., a u32 in wife record)
// AND appear at a consistent husband offset across multiple pairs
console.log(`\nConsistent husband-offset+wifeMarker pairs (count >= 3):`);
for (const [k, c] of [...offsetHistW.entries()].sort((a,b)=>b[1]-a[1])) {
  if (c >= 3 && k.includes('wifeMarker')) {
    console.log(`  ${k}: ${c}`);
  }
}
