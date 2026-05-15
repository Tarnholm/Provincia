#!/usr/bin/env node
// dig-family19.js — finalize spouse pointer + cross-validate on rome10.
//
// Findings to confirm:
//  - In the family-record table (markers '2e 05 00 00' in 21.5-23M), wife
//    firstName name index is at marker-6 (139/165 cases) or marker-10
//    (5+1 cases) or marker-5 (20).
//  - Husband's primaryUuid sits at wifeMarker+40 in 74/112 cross-referenced pairs.
//
// 1) Re-run with both save_1.2.sav and save_rome10.sav to cross-validate.
// 2) Categorize the 38 non-matching pairs — are they layout-shifted or
//    actually the husband-secondaryUuid?
// 3) Also test: do we see wife's "primaryUuid-equivalent" inside the
//    husband's char record as a child slot or other field?

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

function analyze(savePath, label) {
  console.log(`\n=========== ${label} ===========`);
  const buf = fs.readFileSync(savePath);
  const recs = cp.findCharacterRecords(buf, nameLookup, traitNames, null);
  const byFirstLast = new Map();
  for (const r of recs) {
    const key = `${r.firstName}|${r.lastName||''}`;
    if (!byFirstLast.has(key)) byFirstLast.set(key, []);
    byFirstLast.get(key).push(r);
  }

  const knownWifeIdxs = new Map();
  for (const p of pairs) {
    const idx = nameToIdx.get(p.wifeFirst);
    if (idx != null) knownWifeIdxs.set(idx, p.wifeFirst);
  }

  // Wider scan range: try the entire file from 20M to 24M
  const markers = [];
  for (let i = 20000000; i < 24000000 && i + 4 < buf.length; i++) {
    if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
  }
  console.log(`markers found: ${markers.length}`);

  // For each marker, find wife name idx within -16..0 of marker
  const wifeMarkers = [];
  for (const m of markers) {
    for (let o = -16; o <= 0; o++) {
      const pos = m + o;
      if (pos < 0 || pos + 4 > buf.length) continue;
      const v = buf.readUInt32LE(pos);
      if (knownWifeIdxs.has(v)) {
        wifeMarkers.push({ marker: m, wifeOff: o, wifeIdx: v, wifeName: knownWifeIdxs.get(v) });
        break;
      }
    }
  }
  console.log(`markers with known-wife name idx: ${wifeMarkers.length}`);

  // For each wifeMarker, test husband primaryUuid at marker+40
  let p40 = 0, total = 0;
  const alternativeOffsets = new Map();
  const wifeOffHist = new Map();
  for (const wm of wifeMarkers) {
    wifeOffHist.set(wm.wifeOff, (wifeOffHist.get(wm.wifeOff)||0)+1);
    const candidates = pairs.filter(p => p.wifeFirst === wm.wifeName);
    for (const p of candidates) {
      const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
      const husbands = byFirstLast.get(husbandKey);
      if (!husbands || husbands.length !== 1) continue;
      const h = husbands[0];
      total++;
      const v40 = wm.marker + 40 + 4 <= buf.length ? buf.readUInt32LE(wm.marker + 40) : 0;
      if (v40 === h.primaryUuid) p40++;
      // Find where husband.primaryUuid actually lies in the wife record
      for (let i = -50; i <= 200; i++) {
        const pos = wm.marker + i;
        if (pos < 0 || pos + 4 > buf.length) continue;
        if (buf.readUInt32LE(pos) === h.primaryUuid) {
          alternativeOffsets.set(i, (alternativeOffsets.get(i)||0)+1);
        }
      }
      break;
    }
  }
  console.log(`wifeOffset-from-marker histogram:`, [...wifeOffHist.entries()].sort((a,b)=>b[1]-a[1]).map(([o,c])=>`${o}:${c}`).join(' '));
  console.log(`Pairs checked: ${total}, husband.primaryUuid at marker+40: ${p40} (${(100*p40/total).toFixed(1)}%)`);
  console.log(`Where husband.primaryUuid lands in wife record (offset from marker):`);
  for (const [o, c] of [...alternativeOffsets.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10)) {
    console.log(`  marker${o>=0?'+':''}${o}: ${c}`);
  }

  // Also test marker+40 vs husband.secondaryUuid for the remaining cases
  let p40secondary = 0;
  for (const wm of wifeMarkers) {
    const candidates = pairs.filter(p => p.wifeFirst === wm.wifeName);
    for (const p of candidates) {
      const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
      const husbands = byFirstLast.get(husbandKey);
      if (!husbands || husbands.length !== 1) continue;
      const h = husbands[0];
      const v40 = buf.readUInt32LE(wm.marker + 40);
      if (v40 === h.secondaryUuid) p40secondary++;
      break;
    }
  }
  console.log(`marker+40 == husband.secondaryUuid count: ${p40secondary}`);
}

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
analyze(path.join(SAVES, 'save_1.2.sav'), 'save_1.2 (Republic Turn 1)');
const rome10 = path.join(SAVES, 'save_rome10.sav');
if (fs.existsSync(rome10)) analyze(rome10, 'save_rome10');
else analyze(path.join(SAVES, 'save_Autosave   Republic of Rome   Turn 2 Start.sav'), 'Republic Turn 2 Start');
