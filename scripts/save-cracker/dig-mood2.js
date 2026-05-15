// dig-mood2.js — session 91 second attempt.
// Hypothesis from dig-mood1.js: +106 and +110 are u8 stats varying 0..7,
// strongly age-correlated. +126 is 5..10. These are candidate command /
// influence / management / loyalty / mood u8 cache.
//
// Method:
//  1. Pull ALL named LAYOUT_A characters (relax role filter — include 0,1,2,3
//     to catch governors, captains too).
//  2. Compare values at +102, +106, +110, +126, +258 against known trait
//     IDs that map to command (GoodCommander), influence (PoliticsSkill /
//     Senator levels), management (Logistical / Trader / FactionFounder).
//  3. Pearson correlation per offset → trait-presence-level.
//  4. Also check u16 reads at the same offsets (in case stat is stored as
//     low byte of u16 sum).
//
// Trait IDs are not stable across mod versions; we use NAMES from
// export_descr_character_traits.txt and identify trait id by scanning
// the save's record list for the trait name string nearby.
//
// SHORTCUT: characterParser already returns parsed traits with names
// (from the lookup table indexed by id). traitNames in the parser is
// built from export_descr_character_traits.txt load order — but the save
// uses internal ids. So traitNames[tid] returns names from the wrong
// indexing, but the parser only uses truthiness — so the trait *names*
// in parsed records are GARBAGE for level interpretation.
//
// Instead: directly read trait u32 ids from the trait block and group
// by id. We don't need symbolic names — we need to find which trait id
// numerically appears in characters that have high +106 / +110.

"use strict";
const fs = require("fs");
const path = require("path");

const SAVE = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_1.2.sav";
const MOD_DIR = "C:/RIS/RIS/data";
const PROVINCIA = "C:/dev/Provincia";

const { findCharacterRecords } = require(path.join(PROVINCIA, "src", "characterParser.js"));

function loadNameLookup() {
  const txt = fs.readFileSync(path.join(MOD_DIR, "descr_names_lookup.txt"), "utf8");
  const clean = txt.charCodeAt(0) === 0xfeff ? txt.slice(1) : txt;
  return clean.split(/\r?\n/).map(s => s.trim());
}

function loadTraitNames() {
  const txt = fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8");
  const names = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^Trait\s+(\w+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

function main() {
  const buf = fs.readFileSync(SAVE);
  const nameLookup = loadNameLookup();
  const traitNames = loadTraitNames();

  const records = findCharacterRecords(buf, nameLookup, traitNames, null);
  const named = records.filter(r => r.lastName && !r.isDead);
  console.log(`named LAYOUT_A alive: ${named.length}`);

  // === Step 1: extract raw values at suspect offsets across ALL named chars
  const OFFSETS_U8 = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 124, 125, 126, 127, 128, 129, 130, 131, 258, 259, 260];

  // Print full table
  console.log(`\n=== All named LAYOUT_A alive characters ===`);
  console.log(`name\tage\trole\ttraitCount\t${OFFSETS_U8.map(o => "+" + o).join("\t")}`);
  for (const r of named) {
    const vals = OFFSETS_U8.map(o => buf[r.offset + o]);
    const name = `${r.firstName.slice(0, 8)}_${(r.lastName || "?").slice(0, 8)}`;
    console.log(`${name}\t${r.age}\t${r.role}\t${r.traits.length}\t${vals.join("\t")}`);
  }

  // === Step 2: hypothesis — fields cluster as command / mgmt / influence
  // RTW visible stats per general:
  //   command stars 0-10, influence 0-10, management 0-10, loyalty 0-10
  // Let's enumerate trait IDs to see which characters have high stats
  // versus low. First, gather every distinct trait id and its average level
  // grouped by characters with +106 >= 5 vs +106 <= 2.
  const highChars = named.filter(r => buf[r.offset + 106] >= 5);
  const lowChars = named.filter(r => buf[r.offset + 106] <= 2);
  console.log(`\n+106 high (>=5): ${highChars.length} chars; low (<=2): ${lowChars.length} chars`);

  // What's their mean age?
  const meanAge = arr => arr.reduce((s, r) => s + r.age, 0) / arr.length;
  console.log(`mean age high: ${meanAge(highChars).toFixed(1)}, low: ${meanAge(lowChars).toFixed(1)}`);

  // === Step 3: check correlations
  // Age correlation: r(age, +106), r(age, +110), r(age, +126)
  function pearson(arr, fn1, fn2) {
    const xs = arr.map(fn1), ys = arr.map(fn2);
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    return num / Math.sqrt(dx2 * dy2);
  }
  console.log(`\nCorrelations:`);
  for (const off of [102, 106, 110, 126, 258]) {
    const r = pearson(named, c => c.age, c => buf[c.offset + off]);
    const rT = pearson(named, c => c.traits.length, c => buf[c.offset + off]);
    console.log(`  +${off}: r(age,val)=${r.toFixed(3)}, r(traitCount,val)=${rT.toFixed(3)}`);
  }

  // === Step 4: check if +106 / +110 maxes at 10 across larger corpus
  // by scanning ALL records (including LAYOUT_B and dead) — but only for
  // these specific offsets, no trait correlations.
  const allLA = records.filter(r => r.lastName); // LAYOUT_A all
  const o106 = allLA.map(r => buf[r.offset + 106]);
  const o110 = allLA.map(r => buf[r.offset + 110]);
  const o126 = allLA.map(r => buf[r.offset + 126]);
  const stats = arr => {
    const min = Math.min(...arr), max = Math.max(...arr);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const dist = new Set(arr).size;
    const tally = {};
    for (const v of arr) tally[v] = (tally[v] || 0) + 1;
    return { min, max, mean: mean.toFixed(2), n: arr.length, distinct: dist, tally };
  };
  console.log(`\nLAYOUT_A all (n=${allLA.length}):`);
  console.log(`  +106:`, stats(o106));
  console.log(`  +110:`, stats(o110));
  console.log(`  +126:`, stats(o126));

  // === Step 5: also test u32 reads at +96..+128 area in case it's a packed struct
  console.log(`\n=== Hex dump of bytes +96..+140 for first 5 characters ===`);
  for (const r of named.slice(0, 5)) {
    const slice = buf.slice(r.offset + 96, r.offset + 140);
    const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`  ${r.firstName} ${r.lastName} age=${r.age}:`);
    console.log(`    ${hex}`);
  }

  // Save findings
  fs.writeFileSync(path.join(PROVINCIA, "scripts", "save-cracker", "mood-dig-2.json"),
    JSON.stringify({ named: named.length, allLA: allLA.length, stats_106: stats(o106), stats_110: stats(o110), stats_126: stats(o126) }, null, 2));
}

main();
