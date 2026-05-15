// dig-owner-s97-1.js — session 97, attempt 1
// Goal: re-pin RIS-imperial settlement owner-UUID offset on save_1.2.sav.
// Session 96 reports the dynamic detector returns d=-2206 with all-zero
// UUIDs (broken). Top alternate candidates: d=-1878, -1177, -2895.
//
// Method:
//  1. Parse descr_strat → {region → faction}.
//  2. Parse descr_regions → {region → settlementName}.
//  3. Build initialOwnerByCity = {settlementName → faction}.
//  4. For each marker, dump u32 at every offset d ∈ [-3500, -100] and
//     rank d by descr_strat-consistency (UUIDs cluster by faction).
//  5. Print top 15 with detailed metrics; show what the current parser's
//     evaluate() picks. Also exercise the parser directly to verify the
//     "d=-2206 with zero UUIDs" claim.
//  6. Cross-check the top offset's UUID values against the per-faction
//     header UUIDs read from the 23-record faction array (RESEARCH 832+).

"use strict";

const fs = require("fs");
const path = require("path");
const PROVINCIA_SRC = path.resolve(__dirname, "../../src");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const STRAT = "C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
const REGIONS = "C:/RIS/RIS/data/world/maps/base/descr_regions.txt";

const { findAllSettlementMarkers } = require(path.join(PROVINCIA_SRC, "buildingParser.js"));
const { detectOwnerOffset, resolveCurrentOwners, buildUuidToFaction } = require(path.join(PROVINCIA_SRC, "saveOwnershipParser.js"));

// ---------------------- 1. parse descr_regions ----------------------
// Each region block: line `<RegionName>` then indented `<SettlementName>`
// then indented `<faction>` (creator) then `<culture>` then rgb etc.
function parseRegions(text) {
  const lines = text.split(/\r?\n/);
  const regionToCity = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // skip comments and indented lines: region name lines start at column 0
    if (!l.length || l[0] === ';' || /^\s/.test(l)) continue;
    const name = l.trim();
    // Region records look like: RegionName \n \t Settlement \n \t culture \n \t color ...
    // Heuristic: only treat the line as a region if the next non-comment line is indented and is a settlement name (capitalised).
    const next = lines[i + 1] || '';
    if (!/^\s+\S/.test(next)) continue;
    const sett = next.trim();
    if (!/^[A-Z]/.test(sett)) continue;
    regionToCity[name] = sett;
  }
  return regionToCity;
}

// ---------------------- 2. parse descr_strat ------------------------
// faction <id>, ... \n {settlement blocks} \n until next 'faction <id>'.
// Each settlement block contains `region <RegionName>`.
function parseStrat(text) {
  const lines = text.split(/\r?\n/);
  const regionToFac = {};
  let curFac = null;
  let inSettlement = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^faction\s+([a-z_]+)/);
    if (m) { curFac = m[1]; continue; }
    if (/^settlement$/.test(l.trim())) { inSettlement = 1; continue; }
    if (inSettlement && curFac) {
      const mr = l.match(/^\s*region\s+(\S+)/);
      if (mr) {
        regionToFac[mr[1]] = curFac;
        inSettlement = 0;
      }
    }
    // exit settlement block at line "}"  (cheap)
    if (l.trim() === '}') inSettlement = 0;
  }
  return regionToFac;
}

const regionsText = fs.readFileSync(REGIONS, 'utf8');
const stratText = fs.readFileSync(STRAT, 'utf8');
const regionToCity = parseRegions(regionsText);
const regionToFac = parseStrat(stratText);

// initialOwnerByCity = {settlement → faction}
const initialOwnerByCity = {};
for (const [region, fac] of Object.entries(regionToFac)) {
  const city = regionToCity[region];
  if (city) initialOwnerByCity[city] = fac;
}
console.log(`descr_strat: ${Object.keys(regionToFac).length} region→faction mappings`);
console.log(`descr_regions: ${Object.keys(regionToCity).length} region→city mappings`);
console.log(`initialOwnerByCity: ${Object.keys(initialOwnerByCity).length} settlement→faction mappings`);
console.log(`Sample: Rome=${initialOwnerByCity.Rome}, Arretium=${initialOwnerByCity.Arretium}, Carthage=${initialOwnerByCity.Carthage}, Sparta=${initialOwnerByCity.Sparta}`);

// ---------------------- 3. exercise parser directly -----------------
const buf = fs.readFileSync(SAVE);
console.log(`\nsave size: ${buf.length} bytes`);
const setts = findAllSettlementMarkers(buf);
console.log(`settlement markers: ${setts.length}`);
const matchedSetts = setts.filter(s => initialOwnerByCity[s.name]);
console.log(`markers matching descr_strat city names: ${matchedSetts.length} / ${setts.length}`);

console.log(`\n--- Run Provincia's current resolveCurrentOwners() ---`);
const res = resolveCurrentOwners(buf, initialOwnerByCity);
console.log(`detectedOffset = ${res.detectedOffset}`);
console.log(`dictSize = ${res.dictSize}`);
console.log(`unknownCount = ${res.unknownCount}`);
console.log(`ownerByCity keys = ${Object.keys(res.ownerByCity).length}`);
console.log(`Sample unknown: ${JSON.stringify(res.sampleUnknown)}`);
// Count how many resolve to the SAME faction (sign that everything mapped to rebels via zero-UUID).
const facCount = {};
for (const f of Object.values(res.ownerByCity)) facCount[f] = (facCount[f] || 0) + 1;
const facCountSorted = Object.entries(facCount).sort((a, b) => b[1] - a[1]);
console.log(`Resolved-faction histogram (top 10): ${JSON.stringify(facCountSorted.slice(0, 10))}`);

// ---------------------- 4. broad-scan d ∈ [-3500, -100] -------------
// Score = number of settlements whose u32 belongs to a clean cluster matching
// descr_strat. Reuse the parser's logic by importing detectOwnerOffset.
console.log(`\n--- Direct detectOwnerOffset() output ---`);
const det = detectOwnerOffset(buf, setts, initialOwnerByCity);
console.log(JSON.stringify(det));

// Manual top-N scan (no known-good +100 boost).
console.log(`\n--- Top 20 owner-offset candidates by descr_strat consistency (no boost) ---`);
const KNOWN_OFFSETS = [-454, -456, -1944, -1946, -2206, -1878, -1177, -2895];
function evalRaw(d) {
  const uuidToFac = new Map();
  const uuidCount = new Map();
  for (const s of setts) {
    const o = s.offset + d;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = buf.readUInt32LE(o);
    if (v === 0 || v === 0xffffffff) continue;
    uuidCount.set(v, (uuidCount.get(v) || 0) + 1);
    const fac = initialOwnerByCity[s.name];
    if (!fac) continue;
    if (!uuidToFac.has(v)) uuidToFac.set(v, new Map());
    const fm = uuidToFac.get(v);
    fm.set(fac, (fm.get(fac) || 0) + 1);
  }
  let score = 0;
  let cleanUuids = 0;
  for (const [v, fm] of uuidToFac) {
    if ((uuidCount.get(v) || 0) < 2) continue;
    const top = Math.max(...fm.values());
    const total = [...fm.values()].reduce((a, b) => a + b, 0);
    if (top / total >= 0.5) cleanUuids++;
  }
  for (const s of setts) {
    const fac = initialOwnerByCity[s.name];
    if (!fac) continue;
    const o = s.offset + d;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = buf.readUInt32LE(o);
    if (v === 0 || v === 0xffffffff) continue;
    if ((uuidCount.get(v) || 0) < 2) continue;
    const fmap = uuidToFac.get(v);
    if (!fmap) continue;
    const top = Math.max(...fmap.values());
    const total = [...fmap.values()].reduce((a, b) => a + b, 0);
    if (top / total >= 0.5 && (fmap.get(fac) || 0) > 0) score++;
  }
  return { d, score, cleanUuids, distinctUuids: uuidCount.size };
}

const all = [];
for (let d = -3500; d <= -100; d++) {
  all.push(evalRaw(d));
}
all.sort((a, b) => b.score - a.score);
console.log(`Top 20:`);
for (const r of all.slice(0, 20)) {
  console.log(`  d=${String(r.d).padStart(5)} score=${String(r.score).padStart(4)} cleanUuids=${String(r.cleanUuids).padStart(3)} distinctUuids=${r.distinctUuids}`);
}
console.log(`\nKnown-offset checkpoints:`);
for (const d of KNOWN_OFFSETS) {
  const r = evalRaw(d);
  console.log(`  d=${String(d).padStart(5)} score=${String(r.score).padStart(4)} cleanUuids=${String(r.cleanUuids).padStart(3)} distinctUuids=${r.distinctUuids}`);
}

// ---------------------- 5. dump top-candidate UUIDs ----------------------
function dumpCandidate(d, label) {
  console.log(`\n--- Dump candidate ${label} (d=${d}) ---`);
  const uuidToFac = new Map();
  const uuidCount = new Map();
  const uuidSamples = new Map(); // uuid → [city names]
  for (const s of setts) {
    const o = s.offset + d;
    if (o < 0 || o + 4 > buf.length) continue;
    const v = buf.readUInt32LE(o);
    uuidCount.set(v, (uuidCount.get(v) || 0) + 1);
    const fac = initialOwnerByCity[s.name];
    if (!fac) continue;
    if (!uuidToFac.has(v)) uuidToFac.set(v, new Map());
    const fm = uuidToFac.get(v);
    fm.set(fac, (fm.get(fac) || 0) + 1);
    if (!uuidSamples.has(v)) uuidSamples.set(v, []);
    if (uuidSamples.get(v).length < 5) uuidSamples.get(v).push(`${s.name}(${fac})`);
  }
  console.log(`  ${uuidCount.size} distinct u32 values; ${uuidToFac.size} have descr_strat-matched cities`);
  // Top 25 UUIDs by usage with their dominant faction.
  const tops = [...uuidCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [uuid, cnt] of tops) {
    const fm = uuidToFac.get(uuid);
    const facsig = fm ? [...fm.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f}:${c}`).join(', ') : '(no strat hits)';
    const samples = (uuidSamples.get(uuid) || []).join(', ');
    console.log(`    0x${uuid.toString(16).padStart(8, '0')} cnt=${String(cnt).padStart(3)}  fac=[${facsig}]  samples=${samples}`);
  }
}

dumpCandidate(-1878, '-1878');
dumpCandidate(all[0].d, `top scoring d=${all[0].d}`);
dumpCandidate(-2206, '-2206 (parser-current)');
dumpCandidate(-454, '-454 (vanilla)');
dumpCandidate(-1944, '-1944 (prev RIS)');

// ---------------------- 6. find major faction records (signature) ----------------------
console.log(`\n--- Locate the 23 major faction records (RESEARCH session ~50) ---`);
const facRecs = [];
for (let i = 0; i + 64 < buf.length; i++) {
  if (buf.readUInt32LE(i + 8) !== 100) continue;
  if (buf.readUInt32LE(i + 12) !== 1) continue;
  if (buf.readUInt32LE(i + 24) !== i + 24) continue;
  if (buf.readUInt32LE(i + 40) !== i + 40) continue;
  if (buf.readUInt32LE(i + 44) !== 6) continue;
  const regions = buf.readUInt32LE(i + 48);
  if (regions > 200) continue;
  facRecs.push({ pos: i, regions, treasury: buf.readUInt32LE(i) | 0 });
  i += 60;
}
console.log(`found ${facRecs.length} major faction records`);
for (const [idx, r] of facRecs.entries()) {
  console.log(`  [${idx}] @0x${r.pos.toString(16)} regions=${r.regions} treasury=${r.treasury}`);
}

// Header UUIDs candidates per faction-record (relative to faction-record start).
// Common UUID-shaped fields in faction record headers.
if (facRecs.length > 0) {
  console.log(`\n--- Faction-record header u32 fields (look for a UUID we can match to owner) ---`);
  const off0 = facRecs[0].pos;
  // dump first 64 bytes of record 0
  for (let k = 0; k < 64; k += 4) {
    console.log(`    +${k} = 0x${buf.readUInt32LE(off0 + k).toString(16)}  (rec[0] @0x${(off0+k).toString(16)})`);
  }
}

// Cross-reference: are the most-common owner UUIDs at top-scoring d also present
// in the faction record headers somewhere?
const topD = all[0].d;
const ownerUUIDset = new Set();
for (const s of setts) {
  const o = s.offset + topD;
  if (o < 0 || o + 4 > buf.length) continue;
  const v = buf.readUInt32LE(o);
  if (v === 0 || v === 0xffffffff) continue;
  ownerUUIDset.add(v);
}
console.log(`\n--- Cross-ref top-d owner UUIDs vs faction-record bytes (any offset 0..600) ---`);
const matches = [];
for (const [idx, r] of facRecs.entries()) {
  for (let k = 0; k < Math.min(600, buf.length - r.pos - 4); k += 4) {
    const v = buf.readUInt32LE(r.pos + k);
    if (ownerUUIDset.has(v)) matches.push({ idx, k, v });
  }
}
// summarise hits per offset-k
const hitsPerK = new Map();
for (const m of matches) hitsPerK.set(m.k, (hitsPerK.get(m.k) || 0) + 1);
const topK = [...hitsPerK.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`Top header-offset k by # faction records whose +k is an owner UUID:`);
for (const [k, c] of topK) console.log(`  k=+${k}  hits=${c}/${facRecs.length}`);

console.log(`\nDone.`);
