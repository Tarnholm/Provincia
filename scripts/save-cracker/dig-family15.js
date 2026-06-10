#!/usr/bin/env node
// dig-family15.js — investigate compact wife/family record zone around
// pos=22M in save_1.2.sav.
//
// Several known wives produce a single u32 hit in the file body at
// positions ~22050000-22075000 where the byte pattern is:
//   [zero-padding] <wife_name_idx u32> <01> <other_idx u32> <00 00> <2e 05 00 00> <00 00 00 00> <ffffffff ffffffff>
//
// This looks like a compact "family member" record. Let's:
//   - Scan zone 22000000 .. 22200000 for these records.
//   - Each appears to be ~32 bytes. Identify the structure.
//   - Check if the "other_idx" u32 ever matches a husband's secondaryUuid
//     or primaryUuid.

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
const byUuid = new Map(); // primaryUuid -> rec
const bySecUuid = new Map(); // secondaryUuid -> rec
const byFirstLast = new Map();
for (const r of recs) {
  byUuid.set(r.primaryUuid, r);
  bySecUuid.set(r.secondaryUuid, r);
  const key = `${r.firstName}|${r.lastName||''}`;
  if (!byFirstLast.has(key)) byFirstLast.set(key, []);
  byFirstLast.get(key).push(r);
}

// Hex dump helper
function hexDump(off, len=64) {
  let s = '';
  for (let i = 0; i < len; i++) {
    if (off+i >= buf.length) break;
    s += buf[off+i].toString(16).padStart(2,'0') + ' ';
  }
  return s;
}

// 1) Look at the zone 22050000 .. 22080000 for the recurring pattern
// Pattern hypothesis: 32-byte record. +0: nameIdx, +4: 01, +5: idx2, +9-..,
// +14-17: 2e 05 00 00, +18-25: zeros, +26-33: ffffffff x2, then continuing.

// Identify record boundaries by scanning for "2e 05 00 00" (probably a marker)
const marker = Buffer.from([0x2e, 0x05, 0x00, 0x00]);
const positions = [];
for (let i = 22000000; i < 22200000 && i < buf.length - 8; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) {
    positions.push(i);
  }
}
console.log(`'2e 05 00 00' marker hits in zone 22M-22.2M: ${positions.length}`);

// Compute deltas
if (positions.length > 1) {
  const deltas = [];
  for (let i = 1; i < positions.length && deltas.length < 20; i++) {
    deltas.push(positions[i] - positions[i-1]);
  }
  console.log(`first 20 deltas:`, deltas);
}

// Look at the first 5 records: dump 80 bytes from -14 (so marker is at +14)
console.log(`\nFirst 5 record dumps (marker at offset +14):`);
for (const p of positions.slice(0, 8)) {
  const recStart = p - 14;
  console.log(`\n  recStart=${recStart} (marker at +14):`);
  // Decode fields
  const nameIdx = buf.readUInt32LE(recStart);
  const byte4 = buf[recStart+4];
  const idx5 = buf.readUInt32LE(recStart+5);
  // try wife identity
  const wifeName = nameLookup[nameIdx];
  const idx5Name = nameLookup[idx5];
  console.log(`    +0 nameIdx=${nameIdx} (${wifeName||'?'})`);
  console.log(`    +4 byte=${byte4}`);
  console.log(`    +5 u32idx=${idx5} (${idx5Name||'?'})`);
  console.log(`    full hex: ${hexDump(recStart, 80)}`);
}

// 2) Try to match wife record to husband. Husband marker is the
// husband's secondaryUuid (~31-bit). Look in the wife record for u32s
// that match a known husband's secondaryUuid or primaryUuid.

// Build husband-wife pair list from descr_strat
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

// For each marker position, treat as wife record. Find any u32 in the
// wife record that matches a known husband's primary or secondary uuid.
console.log(`\n3) Husband-uuid hits in wife records:`);
let totalChecked = 0;
let matched = 0;
const offsetHist = new Map();
for (const p of positions) {
  const recStart = p - 14;
  // wife name idx
  const wifeNameIdx = buf.readUInt32LE(recStart);
  const wifeName = nameLookup[wifeNameIdx];
  if (!wifeName) continue;
  // Find pair entry with matching wifeFirst
  const matchingPairs = pairs.filter(x => x.wifeFirst === wifeName);
  if (matchingPairs.length === 0) continue;
  // Try each husband
  for (const pair of matchingPairs) {
    const husbandKey = `${pair.husbandFirst}|${pair.husbandLast||''}`;
    const husbands = byFirstLast.get(husbandKey);
    if (!husbands || husbands.length !== 1) continue;
    const h = husbands[0];
    totalChecked++;
    // Scan wife record window for husband's uuid
    let foundInWife = -1;
    let foundType = '';
    for (let i = -50; i < 100; i++) {
      if (recStart + i < 0 || recStart + i + 4 > buf.length) continue;
      const v = buf.readUInt32LE(recStart + i);
      if (v === h.primaryUuid) { foundInWife = i; foundType = 'primary'; break; }
      if (v === h.secondaryUuid) { foundInWife = i; foundType = 'secondary'; break; }
    }
    if (foundInWife >= -50) {
      matched++;
      offsetHist.set(foundInWife + '_' + foundType, (offsetHist.get(foundInWife + '_' + foundType)||0)+1);
      if (matched <= 12) {
        console.log(`   ${pair.husbandFirst} ${pair.husbandLast||''} <-> ${wifeName}: husband.${foundType}Uuid at wifeRec+${foundInWife}`);
      }
    }
  }
}
console.log(`\nTotal wife-husband checks: ${totalChecked}, matched: ${matched}`);
console.log(`Offset histogram (relative to wife record start +14 from marker):`);
const sorted = [...offsetHist.entries()].sort((a,b) => b[1]-a[1]);
for (const [k, c] of sorted.slice(0, 20)) console.log(`  ${k}: ${c}`);
