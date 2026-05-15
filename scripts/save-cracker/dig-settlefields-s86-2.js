// dig-settlefields-s86-2.js — session 86, attempt 2
// Fix from attempt 1: marker names are SETTLEMENT names (Rome, Arretium),
// not region names (Roma, Etruria). Parse descr_regions.txt for the
// region->settlement mapping, then look up population by settlement name.

"use strict";
const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");
const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const MOD_DATA_DIR = "C:/RIS/RIS/data";
const REGIONS_FILE  = path.join(MOD_DATA_DIR, "world/maps/base/descr_regions.txt");
const STRAT_FILE    = path.join(MOD_DATA_DIR, "world/maps/campaign/imperial_campaign/descr_strat.txt");

const { findAllSettlementMarkers } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));

// ---- parse descr_regions.txt: region-name then settlement-name ----
// Format:
//   <region_name>
//   \t<settlement_name>
//   \t<owner_faction>
//   \t<culture>
//   ...
const regionsTxt = fs.readFileSync(REGIONS_FILE, "utf8").split(/\r?\n/);
const regionToSettlement = new Map();
for (let i = 0; i < regionsTxt.length - 1; i++) {
  const line = regionsTxt[i];
  if (line.startsWith(";")) continue;
  if (line.startsWith("\t")) continue;
  if (line.trim() === "") continue;
  if (!/^[A-Za-z]/.test(line)) continue;
  // candidate region line; next line should be \t<settlement>
  const next = regionsTxt[i+1];
  if (!next || !next.startsWith("\t")) continue;
  const region = line.trim();
  const settlement = next.trim();
  if (/^[A-Za-z][A-Za-z0-9_\-]*$/.test(settlement)) {
    regionToSettlement.set(region, settlement);
  }
}
console.log(`region->settlement entries: ${regionToSettlement.size}`);

// ---- parse descr_strat for region->population pairs ----
const stratTxt = fs.readFileSync(STRAT_FILE, "utf8").split(/\r?\n/);
const regionToPop = new Map();
let pendingRegion = null;
for (const raw of stratTxt) {
  const line = raw.trim();
  const rm = line.match(/^region\s+(\S+)/);
  const pm = line.match(/^population\s+(\d+)/);
  if (rm) pendingRegion = rm[1];
  if (pm && pendingRegion) {
    regionToPop.set(pendingRegion, parseInt(pm[1], 10));
    pendingRegion = null;
  }
}
console.log(`region->pop entries: ${regionToPop.size}`);

// Build settlement-name -> pop (descr_strat starting population).
const settlementToPop = new Map();
for (const [region, pop] of regionToPop.entries()) {
  const s = regionToSettlement.get(region);
  if (s) settlementToPop.set(s, pop);
}
console.log(`settlement->pop entries: ${settlementToPop.size}`);

// ---- Markers + details ----
const buf = fs.readFileSync(SAVE);
const SETT_START = 0xf85f00, SETT_END = 0x1f10c72;
const FC_MAGIC = Buffer.from([0xfc,0xfc,0xfc,0xfc,0x64,0x00,0x00,0x00,0x00]);
const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= SETT_START && s.offset < SETT_END);

let matchCount = 0;
for (const m of setts) if (settlementToPop.has(m.name)) matchCount++;
console.log(`markers with known pop: ${matchCount} / ${setts.length}`);

// Details (with both prev/next name association options)
const details = [];
for (let i = 0; i < setts.length; i++) {
  const rs = setts[i].blockEnd;
  const re = (i + 1 < setts.length) ? setts[i + 1].offset : SETT_END;
  if (re - rs < 256) continue;
  const fcIdx = buf.indexOf(FC_MAGIC, rs);
  if (fcIdx < 0 || fcIdx >= rs + 64) continue;
  let termOk = false;
  for (let p = Math.max(rs, re - 16); p + 4 <= re; p++) {
    if (buf[p] === 0xef && buf[p+1] === 0 && buf[p+2] === 0 && buf[p+3] === 0) { termOk = true; break; }
  }
  if (!termOk) continue;
  details.push({
    markerIdx: i,
    prevName: setts[i].name,
    nextName: (i + 1 < setts.length) ? setts[i + 1].name : null,
    start: rs,
    end: re,
    fcIdx,
  });
}
console.log(`detail blobs: ${details.length}`);

function scanU32(slice, val) {
  const hits = [];
  for (let p = 0; p + 4 <= slice.length; p++) {
    if (slice.readUInt32LE(p) === val) hits.push(p);
  }
  return hits;
}

// Histogram of relative-to-FC offsets where population u32 appears.
const histPrev = new Map();
const histNext = new Map();
let prevHits = 0, nextHits = 0;
for (const d of details) {
  const slice = buf.slice(d.start, d.end);
  const rel = d.fcIdx - d.start;
  const popPrev = settlementToPop.get(d.prevName);
  const popNext = d.nextName ? settlementToPop.get(d.nextName) : null;
  if (popPrev && popPrev >= 400) {
    const h = scanU32(slice, popPrev);
    if (h.length) prevHits++;
    for (const x of h) histPrev.set(x - rel, (histPrev.get(x - rel) || 0) + 1);
  }
  if (popNext && popNext >= 400) {
    const h = scanU32(slice, popNext);
    if (h.length) nextHits++;
    for (const x of h) histNext.set(x - rel, (histNext.get(x - rel) || 0) + 1);
  }
}
console.log(`prev-assoc blobs with >=1 pop hit: ${prevHits}`);
console.log(`next-assoc blobs with >=1 pop hit: ${nextHits}`);

function top(h, n) {
  return [...h.entries()].sort((a,b) => b[1]-a[1]).slice(0, n);
}
console.log("\nTop relative-to-FC offsets (prev assoc):");
for (const [k, c] of top(histPrev, 20)) console.log(`  rel ${k} (0x${(k>>>0).toString(16)}): ${c}`);
console.log("\nTop relative-to-FC offsets (next assoc):");
for (const [k, c] of top(histNext, 20)) console.log(`  rel ${k} (0x${(k>>>0).toString(16)}): ${c}`);

// Pick the winning association + top offset, dump distinguishing examples.
const winners = [...top(histPrev, 5), ...top(histNext, 5)].sort((a,b) => b[1]-a[1]);
console.log("\nOverall winners:");
for (const [k, c] of winners.slice(0, 8)) console.log(`  rel ${k}: ${c}`);

// For top prev candidate, verify with named examples.
const topPrev = top(histPrev, 5);
if (topPrev.length) {
  const [bestRel, _bestCount] = topPrev[0];
  console.log(`\n--- verification dump for prev-assoc rel=${bestRel} ---`);
  let verified = 0, mismatched = 0, missing = 0;
  for (const d of details) {
    const pop = settlementToPop.get(d.prevName);
    if (!pop || pop < 400) continue;
    const rel = d.fcIdx - d.start;
    const absInSlice = bestRel + rel;
    if (absInSlice < 0 || absInSlice + 4 > d.end - d.start) { missing++; continue; }
    const v = buf.readUInt32LE(d.start + absInSlice);
    if (v === pop) verified++;
    else mismatched++;
  }
  console.log(`verified: ${verified}, mismatched: ${mismatched}, out-of-bounds: ${missing}`);
  // Show 8 examples
  let shown = 0;
  for (const d of details) {
    const pop = settlementToPop.get(d.prevName);
    if (!pop || pop < 400) continue;
    if (shown >= 8) break;
    const rel = d.fcIdx - d.start;
    const absInSlice = bestRel + rel;
    if (absInSlice < 0 || absInSlice + 4 > d.end - d.start) continue;
    const v = buf.readUInt32LE(d.start + absInSlice);
    console.log(`  ${d.prevName.padEnd(28)} descr_pop=${pop.toString().padStart(6)}  save_u32=${v.toString().padStart(6)}  match=${v===pop}`);
    shown++;
  }
}

// Same for next-assoc
const topNext = top(histNext, 5);
if (topNext.length) {
  const [bestRel, _bc] = topNext[0];
  console.log(`\n--- verification dump for next-assoc rel=${bestRel} ---`);
  let verified = 0, mismatched = 0, missing = 0;
  for (const d of details) {
    if (!d.nextName) continue;
    const pop = settlementToPop.get(d.nextName);
    if (!pop || pop < 400) continue;
    const rel = d.fcIdx - d.start;
    const absInSlice = bestRel + rel;
    if (absInSlice < 0 || absInSlice + 4 > d.end - d.start) { missing++; continue; }
    const v = buf.readUInt32LE(d.start + absInSlice);
    if (v === pop) verified++;
    else mismatched++;
  }
  console.log(`verified: ${verified}, mismatched: ${mismatched}, out-of-bounds: ${missing}`);
  let shown = 0;
  for (const d of details) {
    if (!d.nextName) continue;
    const pop = settlementToPop.get(d.nextName);
    if (!pop || pop < 400) continue;
    if (shown >= 8) break;
    const rel = d.fcIdx - d.start;
    const absInSlice = bestRel + rel;
    if (absInSlice < 0 || absInSlice + 4 > d.end - d.start) continue;
    const v = buf.readUInt32LE(d.start + absInSlice);
    console.log(`  ${d.nextName.padEnd(28)} descr_pop=${pop.toString().padStart(6)}  save_u32=${v.toString().padStart(6)}  match=${v===pop}`);
    shown++;
  }
}
