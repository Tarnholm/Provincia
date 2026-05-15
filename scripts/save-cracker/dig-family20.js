#!/usr/bin/env node
// dig-family20.js — break down spouse pointer detection by wife-record layout.
//
// Split pairs by wifeOff (offset of wife name idx from marker). Test:
//   - Layout -6 (most common): husband.primaryUuid at marker+40?
//   - Layout -5: husband.primaryUuid at what offset?
//   - Layout -4: ?
//   - Layout -10: ?

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

const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const buf = fs.readFileSync(path.join(SAVES, 'save_1.2.sav'));
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

const markers = [];
for (let i = 20000000; i < 24000000 && i + 4 < buf.length; i++) {
  if (buf[i] === 0x2e && buf[i+1] === 0x05 && buf[i+2] === 0x00 && buf[i+3] === 0x00) markers.push(i);
}

// Group wifeMarkers by wifeOff
const byLayout = { '-6': [], '-5': [], '-4': [], '-10': [] };
for (const m of markers) {
  for (let o = -16; o <= 0; o++) {
    const pos = m + o;
    if (pos < 0 || pos + 4 > buf.length) continue;
    const v = buf.readUInt32LE(pos);
    if (knownWifeIdxs.has(v)) {
      const wm = { marker: m, wifeOff: o, wifeIdx: v, wifeName: knownWifeIdxs.get(v) };
      if (byLayout[String(o)]) byLayout[String(o)].push(wm);
      break;
    }
  }
}

for (const L of ['-6','-5','-4','-10']) {
  console.log(`\n=== Layout wifeOff=${L} (${byLayout[L].length} records) ===`);
  const hubOffHist = new Map();
  let total = 0;
  for (const wm of byLayout[L]) {
    const candidates = pairs.filter(p => p.wifeFirst === wm.wifeName);
    for (const p of candidates) {
      const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
      const husbands = byFirstLast.get(husbandKey);
      if (!husbands || husbands.length !== 1) continue;
      const h = husbands[0];
      total++;
      for (let i = -50; i <= 200; i++) {
        const pos = wm.marker + i;
        if (pos < 0 || pos + 4 > buf.length) continue;
        if (buf.readUInt32LE(pos) === h.primaryUuid) {
          hubOffHist.set(i, (hubOffHist.get(i)||0)+1);
        }
      }
      break;
    }
  }
  console.log(`pairs checked: ${total}`);
  const sorted = [...hubOffHist.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 10);
  for (const [o, c] of sorted) {
    console.log(`   marker${o>=0?'+':''}${o}: ${c} (${(100*c/total).toFixed(1)}%)`);
  }
}

// Cross-test: for each wifeOff layout, what fraction of pairs have ANY hit?
console.log(`\n--- Coverage per layout ---`);
for (const L of ['-6','-5','-4','-10']) {
  let total = 0, hit = 0;
  for (const wm of byLayout[L]) {
    const candidates = pairs.filter(p => p.wifeFirst === wm.wifeName);
    for (const p of candidates) {
      const husbandKey = `${p.husbandFirst}|${p.husbandLast||''}`;
      const husbands = byFirstLast.get(husbandKey);
      if (!husbands || husbands.length !== 1) continue;
      const h = husbands[0];
      total++;
      let anyhit = false;
      for (let i = -50; i <= 200; i++) {
        const pos = wm.marker + i;
        if (pos < 0 || pos + 4 > buf.length) continue;
        if (buf.readUInt32LE(pos) === h.primaryUuid) { anyhit = true; break; }
      }
      if (anyhit) hit++;
      break;
    }
  }
  console.log(`  layout ${L}: ${hit}/${total} = ${(100*hit/total).toFixed(1)}%`);
}
