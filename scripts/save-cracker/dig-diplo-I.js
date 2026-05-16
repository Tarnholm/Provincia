// dig-diplo-I.js — session 109 step I
//
// Cross-validate B/C semantics with descr_strat ground-truth.
//
// descr_strat.txt counts (RIS imperial, "for claude/descr_strat.txt"):
//   core_attitudes lines: 1109
//     value -10 (Locked Allied):   172
//     value   0 (Allied):           222
//     value 400 (Hostile):            1
//     value 600 (War):              714
//   faction_relationships lines: 432
//     value 199 (Ally/Trade):       175
//     value 200 (Neutral):            2
//     value 250 (Aggressive):        34
//     value 300 (More aggressive):    1
//     value 600 (War):              220
//
// In save_10_fresh, our 780 entries have B distribution:
//   B=0 (most common after B=2): 301 entries → likely "peace/default"
//   B=1: 42 entries                          → likely "ceasefire/treaty"
//   B=2 (most common): 429 entries           → likely "war"
//   B=4: 8 entries                           → likely "alliance"
//
// To cross-validate: count the descr_strat entries that would seed each
// state at T0:
//   * core_attitudes 600 (714) + faction_relationships 600 (220) = 934
//     instances of "war seeding". If each seed instantiates ONE save
//     entry (no de-duplication), we'd see ~934 B=2 entries; observed 429.
//   * The 2× factor could be because we only see 780 entries, but if seeds
//     are de-duplicated PER PAIR (not per direction), 934/2 = 467 ≈ 429.
//
// Let's test more carefully: descr_strat entries are DIRECTED (factionA →
// factionB), but in-save A may be UNDIRECTED. So divide by 2.
//
// Plan:
//   1. Parse all descr_strat faction_relationships and core_attitudes
//      entries.
//   2. For each pair (A, B), pick the strongest declaration (war > ally).
//   3. Count expected save entries by category.
//   4. Compare to observed save B distribution.
//
// Usage: node dig-diplo-I.js
"use strict";

const fs = require("fs");
const path = require("path");

const SAVE = path.join(__dirname, "fixtures", "feral", "save_10_fresh.sav");
const buf = fs.readFileSync(SAVE);

// === Step 1: parse descr_strat ===
const DESCR_STRAT = path.join(__dirname, "..", "..", "for claude", "descr_strat.txt");
const ds = fs.readFileSync(DESCR_STRAT, "utf8");

const coreAtt = []; // { fromFac, value, toFac }
const factionRel = []; // { fromFac, value, toFac }
for (const line of ds.split(/\r?\n/)) {
  if (/^\s*;/.test(line)) continue;
  const trimmed = line.trim();
  // core_attitudes <fromFaction> <value> <toFaction>
  let m;
  if ((m = trimmed.match(/^core_attitudes\s+(\S+)\s+(-?\d+)\s+(\S+)/))) {
    coreAtt.push({ fromFac: m[1], value: parseInt(m[2], 10), toFac: m[3] });
  } else if ((m = trimmed.match(/^faction_relationships\s+(\S+),?\s+(-?\d+)\s+(\S+)/))) {
    factionRel.push({ fromFac: m[1], value: parseInt(m[2], 10), toFac: m[3] });
  }
}
console.log(`Parsed: ${coreAtt.length} core_attitudes, ${factionRel.length} faction_relationships`);

// Count by value
const coreHisto = {};
coreAtt.forEach((e) => { coreHisto[e.value] = (coreHisto[e.value] || 0) + 1; });
console.log(`core_attitudes value distribution:`);
Object.entries(coreHisto).sort((a, b) => +a[0] - +b[0]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

const relHisto = {};
factionRel.forEach((e) => { relHisto[e.value] = (relHisto[e.value] || 0) + 1; });
console.log(`faction_relationships value distribution:`);
Object.entries(relHisto).sort((a, b) => +a[0] - +b[0]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// Count unique faction pairs in core_attitudes (regardless of direction)
const corePairs = new Set();
coreAtt.forEach((e) => {
  const pair = [e.fromFac, e.toFac].sort().join("|");
  corePairs.add(pair);
});
console.log(`Unique unordered faction pairs in core_attitudes: ${corePairs.size}`);

// Same for faction_relationships
const relPairs = new Set();
factionRel.forEach((e) => {
  const pair = [e.fromFac, e.toFac].sort().join("|");
  relPairs.add(pair);
});
console.log(`Unique unordered pairs in faction_relationships: ${relPairs.size}`);

// Union
const allPairs = new Set([...corePairs, ...relPairs]);
console.log(`Total unique pairs (union): ${allPairs.size}`);

// For each pair, determine the STATE class:
//   * if war (600 in core or 600/250/300 in relationships): WAR
//   * if alliance forced (-10 in core): ALLIANCE_FORCED
//   * if allied (0 in core or 199 in relationships): ALLIED
//   * if neutral (200 in relationships): NEUTRAL
//   * else: DEFAULT (no declaration)
function pairState(pair) {
  const [a, b] = pair.split("|");
  let warSeen = false, allianceForced = false, allied = false, neutral = false;
  for (const e of coreAtt) {
    const p = [e.fromFac, e.toFac].sort().join("|");
    if (p !== pair) continue;
    if (e.value >= 400) warSeen = true;
    if (e.value === -10) allianceForced = true;
    if (e.value === 0) allied = true;
  }
  for (const e of factionRel) {
    const p = [e.fromFac, e.toFac].sort().join("|");
    if (p !== pair) continue;
    if (e.value >= 250) warSeen = true;
    if (e.value === 199) allied = true;
    if (e.value === 200) neutral = true;
  }
  if (warSeen) return "WAR";
  if (allianceForced) return "ALLIANCE_FORCED";
  if (allied) return "ALLIED";
  if (neutral) return "NEUTRAL";
  return "OTHER";
}

const stateHisto = { WAR: 0, ALLIANCE_FORCED: 0, ALLIED: 0, NEUTRAL: 0, OTHER: 0 };
for (const pair of allPairs) {
  stateHisto[pairState(pair)]++;
}
console.log(`\nDeclared pair-state distribution (one per unordered pair):`);
Object.entries(stateHisto).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// === Step 2: from save_10_fresh, get B distribution ===
function findValidMarkers(buf) {
  const markers = [];
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) markers.push(i);
  }
  return markers.filter((off) => {
    const count = buf.readUInt32LE(off + 4);
    if (count > 200 || count === 0) return false;
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      if (e + 16 > buf.length) return false;
      if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) return false;
    }
    return true;
  });
}

const valid = findValidMarkers(buf);
const bHisto = {};
for (const off of valid) {
  const count = buf.readUInt32LE(off + 4);
  for (let k = 0; k < count; k++) {
    const e = off + 8 + k * 16;
    const B = buf.readUInt32LE(e + 4);
    bHisto[B] = (bHisto[B] || 0) + 1;
  }
}
console.log(`\nSave B distribution (save_10_fresh):`);
Object.entries(bHisto).sort((a, b) => +a[0] - +b[0]).forEach(([k, v]) => console.log(`  B=${k}: ${v}`));

// === Step 3: hypothesis mapping ===
console.log(`\n=== Hypothesis cross-validation ===`);
console.log(`Hypothesis: B=0 → DEFAULT/PEACE  B=1 → CEASEFIRE  B=2 → WAR  B=4 → ALLIANCE`);
console.log(`Save B=2 count: ${bHisto[2] || 0}  vs  descr_strat WAR pairs: ${stateHisto.WAR}`);
console.log(`Save B=4 count: ${bHisto[4] || 0}  vs  descr_strat ALLIANCE_FORCED: ${stateHisto.ALLIANCE_FORCED}`);
console.log(`Save B=0 count: ${bHisto[0] || 0}  vs  descr_strat (ALLIED + OTHER): ${stateHisto.ALLIED + stateHisto.OTHER}`);
console.log(`Save B=1 count: ${bHisto[1] || 0}  vs  descr_strat NEUTRAL: ${stateHisto.NEUTRAL}`);
console.log(``);
console.log(`Total save entries: ${valid.reduce((s, off) => s + buf.readUInt32LE(off + 4), 0)}`);
console.log(`Total descr_strat declared pairs: ${allPairs.size}`);
// Save may have entries for pairs not in descr_strat (defaults assigned at runtime)
