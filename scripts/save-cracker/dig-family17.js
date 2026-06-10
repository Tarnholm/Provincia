#!/usr/bin/env node
// dig-family17.js — robust husband-pointer hunt in compact family table.
//
// The "wife records" are part of a broader "family_records" table at
// ~22M. Each record is 364-368 bytes. firstName at +4, gender at +8 (=1 for
// alive named family), lastName at +9, marker '2e 05 00 00' at +14.
//
// To find husband pointer: for each KNOWN wife (her firstName matches the
// 2nd token of a `relative` line in descr_strat AND her lastName matches
// husband's lastName), check whether a u32 in the wife record matches:
//   - husband's primaryUuid
//   - husband's secondaryUuid
//   - husband's record offset
//   - husband's offset-47 (where primaryUuid lives)
//   - husband's firstName name index
//   - or some other husband identifier

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
const byFirstLast = new Map();
for (const r of recs) {
  const key = `${r.firstName}|${r.lastName||''}`;
  if (!byFirstLast.has(key)) byFirstLast.set(key, []);
  byFirstLast.get(key).push(r);
}

// Wife list from descr_strat relative lines
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

// Find wife records: scan markers, decode firstName/lastName/gender
const markers = [];
for (let i = 21500000; i < 23000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}

const wifeRecs = [];
for (const m of markers) {
  const rs = m - 14;
  if (rs < 0) continue;
  const f = buf.readUInt32LE(rs + 4);
  const g = buf[rs + 8];
  const l = buf.readUInt32LE(rs + 9);
  if (g !== 1 || f >= nameLookup.length || l >= nameLookup.length) continue;
  const firstName = nameLookup[f];
  const lastName = nameLookup[l];
  if (!firstName || !lastName) continue;
  wifeRecs.push({ recStart: rs, firstName, lastName });
}
console.log(`Plausible family records (gender=1): ${wifeRecs.length}`);

// For each wife in `pairs`, look up the family record where firstName==wife AND lastName==husbandLast
let pairsMatched = 0;
const offsetHist = new Map();
let detailShown = 0;

for (const p of pairs) {
  if (!p.husbandLast) continue;
  const husbandKey = `${p.husbandFirst}|${p.husbandLast}`;
  const husbands = byFirstLast.get(husbandKey);
  if (!husbands || husbands.length !== 1) continue;
  const h = husbands[0];

  // Find wife record
  const wr = wifeRecs.find(x => x.firstName === p.wifeFirst && x.lastName === p.husbandLast);
  if (!wr) continue;
  pairsMatched++;

  // Search wife record for various husband identifiers
  const hubIds = [
    { val: h.primaryUuid, tag: 'primaryUuid' },
    { val: h.secondaryUuid, tag: 'secondaryUuid' },
    { val: h.offset, tag: 'recOffset' },
    { val: nameToIdx.get(p.husbandFirst), tag: 'hubFirstIdx' },
  ];
  // Also: husband's char record offset relative within file
  for (let i = -16; i + 4 <= 200; i++) {
    const off = wr.recStart + i;
    if (off < 0 || off + 4 > buf.length) continue;
    const v = buf.readUInt32LE(off);
    for (const id of hubIds) {
      if (id.val != null && v === id.val) {
        const k = `${i}_${id.tag}`;
        offsetHist.set(k, (offsetHist.get(k)||0)+1);
        if (detailShown < 12) {
          console.log(`  ${p.husbandFirst} ${p.husbandLast} <-> ${p.wifeFirst}: wifeRec+${i} = husband.${id.tag}=${id.val}`);
          detailShown++;
        }
      }
    }
  }
}

console.log(`\nPairs matched (wife rec found, husband parsed): ${pairsMatched}`);
console.log(`\nOffset histogram (rel to wife recStart):`);
for (const [k, c] of [...offsetHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30)) {
  console.log(`  ${k}: ${c}`);
}

// Also try the reverse: husband record contains wife's pointer.
// Build wife "uuid-equivalent" — maybe the wife's recStart, or the wife's
// firstName idx + lastName idx pair, or some position in wife rec.
console.log(`\n--- Husband record contains wife pointer? ---`);
const offsetHist2 = new Map();
let p2matched = 0;
const exH2 = [];

for (const p of pairs) {
  if (!p.husbandLast) continue;
  const husbandKey = `${p.husbandFirst}|${p.husbandLast}`;
  const husbands = byFirstLast.get(husbandKey);
  if (!husbands || husbands.length !== 1) continue;
  const h = husbands[0];
  const wr = wifeRecs.find(x => x.firstName === p.wifeFirst && x.lastName === p.husbandLast);
  if (!wr) continue;
  p2matched++;

  // Candidates that might point to wife: wr.recStart, wr.recStart+14, wr.recStart-something
  // Try the literal wife recStart as a u32 (file offset within 32-bit range — yes, 22M < 2^31)
  const wifeCandidates = [
    { val: wr.recStart, tag: 'wifeRecStart' },
    { val: wr.recStart + 14, tag: 'wifeMarkerPos' },
    { val: wr.recStart + 4, tag: 'wifeNameAt+4' },
  ];
  // Also try u32s read from various wife-record offsets — maybe wife has a
  // "wifeUuid" at some known offset that the husband references.
  for (let wo = 0; wo + 4 <= 200; wo += 4) {
    const wv = buf.readUInt32LE(wr.recStart + wo);
    if (wv && wv !== 0xffffffff && wv > 1000) {
      wifeCandidates.push({ val: wv, tag: `wifeRec+${wo}` });
    }
  }
  // Scan husband record window for these
  for (let i = -50; i + 4 <= 200; i++) {
    const off = h.offset + i;
    if (off < 0 || off + 4 > buf.length) continue;
    const v = buf.readUInt32LE(off);
    for (const wc of wifeCandidates) {
      if (v === wc.val) {
        const k = `${i}_${wc.tag}`;
        offsetHist2.set(k, (offsetHist2.get(k)||0)+1);
        if (exH2.length < 30) exH2.push(`${p.husbandFirst} ${p.husbandLast}<->${p.wifeFirst}: husbandRec${i>=0?'+':''}${i} = ${wc.tag}=${wc.val}`);
      }
    }
  }
}
console.log(`Pairs checked: ${p2matched}`);
console.log(`Top offset+source pairs:`);
for (const [k, c] of [...offsetHist2.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30)) {
  console.log(`  ${k}: ${c}`);
}
console.log(`\nExamples:`);
for (const e of exH2.slice(0, 25)) console.log('  ', e);
