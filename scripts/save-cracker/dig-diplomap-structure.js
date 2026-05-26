// dig-diplomap-structure.js
//
// FULL structural byte map of the per-faction diplomacy zone.
// Goal: every byte from marker-64 .. footer documented as constant/varies.
//
// Covers:
//   1. Header/preamble (marker-64 .. marker) for major + minor + player zones
//   2. The 16-byte entry: relationUuid / class / attitude / tag distributions
//   3. Footer: bytes immediately after the last entry
//   4. Entry ordering (sorted by uuid? class? unordered?)
//   5. count sanity vs valid entries before footer
//
// Pure read. Usage: node dig-diplomap-structure.js [savePath]
"use strict";
const fs = require("fs");
const path = require("path");

const SAVES = {
  seleucid:
    "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav",
  macedon:
    "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav",
};
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const MARKER = 0x39240005;

function parseFactionOrder(text) {
  const order = []; let cur = null, depth = 0, inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim(); if (s.startsWith(";")) continue;
    const prev = depth; for (const ch of s) { if (ch === "{") depth++; if (ch === "}") depth--; }
    if (inBlock && depth === 0) { cur = null; inBlock = false; }
    if (prev === 0 && depth === 0) { const m = s.match(/^"([^"]+)"\s*:/); if (m && m[1].toLowerCase() !== "factions") cur = m[1].toLowerCase(); }
    if (cur && prev === 0 && depth === 1) { inBlock = true; if (!order.includes(cur)) order.push(cur); }
  }
  return order;
}

function hex(buf, a, b) {
  let s = "";
  for (let i = a; i < b; i++) s += buf[i].toString(16).padStart(2, "0") + " ";
  return s.trim();
}

// Find all diplomacy zones (marker + count + faction id at -53).
function findZones(buf, fo) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    // structural validity: all entries readable
    const end = i + 8 + count * 16;
    if (end > buf.length) continue;
    const fid = buf[i - 53];
    const name = fid < fo.length ? fo[fid] : `?fid${fid}`;
    zones.push({ off: i, count, fid, name, entriesEnd: end });
  }
  return zones;
}

function run(savePath, fo) {
  const buf = fs.readFileSync(savePath);
  const zones = findZones(buf, fo);
  console.log(`\n===================================================================`);
  console.log(`SAVE: ${path.basename(savePath)}  size=${buf.length}  zones=${zones.length}`);
  console.log(`===================================================================`);

  // ---- 1. PREAMBLE: which of marker-64..marker bytes are constant vs vary ----
  // Build, per relative offset (-64..-1), the set of distinct byte values.
  const PRE = 64;
  const distinct = Array.from({ length: PRE }, () => new Map());
  for (const z of zones) {
    if (z.off - PRE < 0) continue;
    for (let r = 0; r < PRE; r++) {
      const v = buf[z.off - PRE + r];
      const m = distinct[r];
      m.set(v, (m.get(v) || 0) + 1);
    }
  }
  console.log(`\n--- PREAMBLE byte volatility (relative to marker, ${zones.length} zones) ---`);
  console.log(`rel  : distinctVals  topValue(count)   note`);
  for (let r = 0; r < PRE; r++) {
    const rel = r - PRE; // -64..-1
    const m = distinct[r];
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const isConst = m.size === 1;
    let note = "";
    if (rel === -53) note = "<-- KNOWN faction-id byte (u8 into descr_sm_factions)";
    if (isConst) note = note || "CONST";
    console.log(
      `${String(rel).padStart(4)} : ${String(m.size).padStart(3)} vals       0x${top[0].toString(16).padStart(2,"0")}(${top[1]})` +
      (m.size <= 6 ? `   [${sorted.map(([v,c])=>`0x${v.toString(16).padStart(2,"0")}:${c}`).join(" ")}]` : `   varies`) +
      (note ? `   ${note}` : "")
    );
  }

  // ---- raw preamble dumps: a major, a minor, and the player(att5) zone ----
  // Major = one in the class-100 record set (high count, fid in first 23). We
  // just pick: first zone, a mid zone, and the att5/player zone.
  let playerZone = null;
  for (const z of zones) {
    for (let k = 0; k < z.count; k++) {
      if (buf.readUInt32LE(z.off + 8 + k * 16 + 8) === 5) { playerZone = z; break; }
    }
    if (playerZone) break;
  }
  const samples = [];
  samples.push({ tag: "FIRST  ", z: zones[0] });
  samples.push({ tag: "MIDDLE ", z: zones[Math.floor(zones.length / 2)] });
  samples.push({ tag: "LAST   ", z: zones[zones.length - 1] });
  if (playerZone) samples.push({ tag: "PLAYER ", z: playerZone });
  console.log(`\n--- RAW preamble dumps (marker-64 .. marker) ---`);
  for (const s of samples) {
    const z = s.z;
    if (z.off - PRE < 0) continue;
    console.log(`${s.tag} ${z.name}(fid=${z.fid}) @0x${z.off.toString(16)} count=${z.count}`);
    // print in two rows of 32
    console.log(`   [-64..-33] ${hex(buf, z.off - 64, z.off - 32)}`);
    console.log(`   [-32..-1 ] ${hex(buf, z.off - 32, z.off)}`);
    console.log(`   marker+0   ${hex(buf, z.off, z.off + 8)}  (= marker u32 + count u32=${z.count})`);
  }

  // ---- 2. ENTRY FIELD distributions across ALL entries in ALL zones ----
  const classFreq = new Map(), attFreq = new Map(), tagFreq = new Map();
  let totalEntries = 0;
  let tagAnomalies = [];
  let uuidMin = Infinity, uuidMax = -Infinity;
  for (const z of zones) {
    for (let k = 0; k < z.count; k++) {
      const o = z.off + 8 + k * 16;
      const uuid = buf.readUInt32LE(o);
      const cls = buf.readUInt32LE(o + 4);
      const att = buf.readUInt32LE(o + 8);
      const tag = buf.readUInt32LE(o + 12);
      classFreq.set(cls, (classFreq.get(cls) || 0) + 1);
      attFreq.set(att, (attFreq.get(att) || 0) + 1);
      tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
      if (tag !== 0x00010101 && tagAnomalies.length < 30) {
        tagAnomalies.push({ zone: z.name, fid: z.fid, off: o, k, uuid, cls, att, tag });
      }
      if (uuid < uuidMin) uuidMin = uuid;
      if (uuid > uuidMax) uuidMax = uuid;
      totalEntries++;
    }
  }
  const fmt = (m) => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}:${c}`).join("  ");
  const fmtHex = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `0x${(v>>>0).toString(16)}:${c}`).join("  ");
  console.log(`\n--- ENTRY FIELD distributions (all ${totalEntries} entries across ${zones.length} zones) ---`);
  console.log(`+4  class    distinct values:count -> ${fmt(classFreq)}`);
  console.log(`+8  attitude distinct values:count -> ${fmt(attFreq)}`);
  console.log(`+12 tag      distinct values:count -> ${fmtHex(tagFreq)}`);
  console.log(`+0  uuid     range: min=${uuidMin} (0x${uuidMin.toString(16)}) max=${uuidMax} (0x${uuidMax.toString(16)})`);
  if (tagAnomalies.length) {
    console.log(`  TAG ANOMALIES (tag != 0x00010101):`);
    for (const a of tagAnomalies) {
      console.log(`    ${a.zone}(fid${a.fid}) entry[${a.k}] @0x${a.off.toString(16)} uuid=${a.uuid} class=${a.cls} att=${a.att} tag=0x${(a.tag>>>0).toString(16)}`);
    }
  } else {
    console.log(`  tag is ALWAYS 0x00010101 (no anomalies)`);
  }

  // ---- 4. ENTRY ORDERING: per-zone, is uuid strictly increasing? ----
  let uuidSortedZones = 0, uuidUnsortedZones = 0;
  const unsortedExamples = [];
  for (const z of zones) {
    let sorted = true, prev = -1;
    for (let k = 0; k < z.count; k++) {
      const uuid = buf.readUInt32LE(z.off + 8 + k * 16);
      if (uuid <= prev) { sorted = false; }
      prev = uuid;
    }
    if (sorted) uuidSortedZones++;
    else { uuidUnsortedZones++; if (unsortedExamples.length < 5) unsortedExamples.push(z); }
  }
  console.log(`\n--- ORDERING: uuid strictly increasing within zone? ---`);
  console.log(`  sorted zones=${uuidSortedZones}  unsorted=${uuidUnsortedZones}`);
  for (const z of unsortedExamples) {
    const us = [];
    for (let k = 0; k < Math.min(z.count, 16); k++) us.push(buf.readUInt32LE(z.off + 8 + k * 16));
    console.log(`    UNSORTED ${z.name}(fid${z.fid}) first16 uuids: ${us.join(",")}`);
  }

  // ---- 3. FOOTER: bytes immediately after last entry (32 bytes) ----
  // Also test count sanity: does a 17th-style entry exist that looks valid?
  console.log(`\n--- FOOTER: 32 bytes after entries (marker+8+16*count) ---`);
  for (const s of samples) {
    const z = s.z;
    const f = z.entriesEnd;
    if (f + 32 > buf.length) continue;
    console.log(`${s.tag} ${z.name}(fid${z.fid}) footer @0x${f.toString(16)}:`);
    console.log(`   ${hex(buf, f, f + 32)}`);
    // interpret first u32s
    console.log(`   u32@+0=${buf.readUInt32LE(f)} (0x${buf.readUInt32LE(f).toString(16)})  u32@+4=${buf.readUInt32LE(f+4)}  u32@+8=${buf.readUInt32LE(f+8)}`);
  }

  // ---- footer pattern volatility across ALL zones (first 16 bytes) ----
  const FOOT = 16;
  const fdist = Array.from({ length: FOOT }, () => new Map());
  let footUsable = 0;
  for (const z of zones) {
    const f = z.entriesEnd;
    if (f + FOOT > buf.length) continue;
    footUsable++;
    for (let r = 0; r < FOOT; r++) {
      const v = buf[f + r];
      fdist[r].set(v, (fdist[r].get(v) || 0) + 1);
    }
  }
  console.log(`\n--- FOOTER byte volatility (${footUsable} zones), offset relative to last-entry-end ---`);
  for (let r = 0; r < FOOT; r++) {
    const m = fdist[r];
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    console.log(`  +${String(r).padStart(2)} : ${String(m.size).padStart(3)} vals  top=0x${top[0].toString(16).padStart(2,"0")}(${top[1]})` + (m.size <= 6 ? `  [${sorted.map(([v,c])=>`0x${v.toString(16).padStart(2,"0")}:${c}`).join(" ")}]` : "  varies"));
  }

  // ---- 5. COUNT SANITY: does count match a natural entry boundary? ----
  // We define an entry "valid" if tag==0x00010101 AND class in known small set.
  // Then check whether count == number of leading valid entries.
  console.log(`\n--- COUNT SANITY (does declared count == leading valid-entry run?) ---`);
  let mismatches = 0;
  for (const z of zones) {
    let validRun = 0;
    for (let k = 0; k < z.count; k++) {
      const o = z.off + 8 + k * 16;
      const tag = buf.readUInt32LE(o + 12);
      const cls = buf.readUInt32LE(o + 4);
      if (tag === 0x00010101 && cls <= 16) validRun++;
      else break;
    }
    if (validRun !== z.count) {
      mismatches++;
      if (mismatches <= 10) console.log(`  MISMATCH ${z.name}(fid${z.fid}) count=${z.count} validRun=${validRun}`);
    }
  }
  console.log(`  zones with count != validRun: ${mismatches} / ${zones.length}`);

  // ---- relate the att5 PLAYER zone shape vs NPC zones ----
  if (playerZone) {
    let c5 = 0;
    for (let k = 0; k < playerZone.count; k++) if (buf.readUInt32LE(playerZone.off + 8 + k*16 + 8) === 5) c5++;
    console.log(`\n--- PLAYER zone shape ---`);
    console.log(`  ${playerZone.name}(fid${playerZone.fid}) count=${playerZone.count}  attitude==5 entries=${c5}`);
  }

  return { zones, classFreq, attFreq, tagFreq, totalEntries };
}

const fo = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));
console.log(`factionOrder loaded: ${fo.length} factions`);
for (const key of Object.keys(SAVES)) {
  if (fs.existsSync(SAVES[key])) run(SAVES[key], fo);
  else console.log(`MISSING save: ${SAVES[key]}`);
}
