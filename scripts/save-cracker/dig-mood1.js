// dig-mood1.js — session 91.
// Goal: locate u8/u16/f32 fields in character records storing
// mood / loyalty / influence (RTW general stats 0..10).
//
// Method:
//  1. Parse every character record in save_1.2 using characterParser.js.
//  2. For each record, dump bytes [0..540] aligned by record start.
//  3. Compute per-offset statistics across all "named character" records
//     (skip captains / family women — they have different fields). For
//     each offset we want:
//       - min, max, distinct-value-count
//       - mean
//       - whether values cluster in 0..10 (mood/loyalty/influence range)
//  4. Identify offsets that:
//       a. Vary across characters (distinct > 3)
//       b. Stay in 0..10 (or 0..20 — influence can go higher)
//       c. Are NOT already known fields (age, role, traits, UUIDs, etc.)
//  5. Print top candidates sorted by promising-ness.
//
// Known field offsets to EXCLUDE from candidate list (LAYOUT_A):
//   +0..+3    firstName u32
//   +4        gender u8
//   +5..+8    lastName u32
//   +9        pad
//   +18..+25  0xff sentinel / clanHead u32 + relType u32
//   +26       age (242 - age)
//   +30..+33  death marker u32
//   +34       pad
//   +42       role u8
//   +46..+49  fatherUuid u32
//   +54..+69  childUuids 4×u32
//   +86..+87  ageFineQuarter u16
//   +302..+303 traitCount u16
//   +308+     traits block (variable length)

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
  // Trait names are in export_descr_character_traits.txt: lines like "Trait Name"
  const txt = fs.readFileSync(path.join(MOD_DIR, "export_descr_character_traits.txt"), "utf8");
  const names = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^Trait\s+(\w+)/);
    if (m) names.push(m[1]);
  }
  // Pad to large array; lookup is by id (sparse). Use object-like.
  // characterParser uses traitNames[tid]; we need indexed.
  // export_descr_character_traits doesn't have explicit ids; ids are inferred by load order.
  // For our parser's needs, we just need traitNames[tid] to return truthy for valid ids.
  // The actual save uses internal trait ids that may not match load order.
  // Workaround: build a Proxy-like that returns the name if id < length else undefined.
  // For now: rely on truthy strings.
  return names;
}

function main() {
  const buf = fs.readFileSync(SAVE);
  console.log(`save: ${buf.length} bytes`);

  const nameLookup = loadNameLookup();
  console.log(`names: ${nameLookup.length}`);
  const traitNames = loadTraitNames();
  console.log(`traits: ${traitNames.length}`);

  // Use broad scan
  const records = findCharacterRecords(buf, nameLookup, traitNames, null);
  console.log(`records found: ${records.length}`);

  // Filter to LAYOUT_A "named character" only — has lastName and role 0 or 1 (general/heir)
  const named = records.filter(r => r.lastName && (r.role === 0 || r.role === 1) && !r.isDead);
  console.log(`named LAYOUT_A alive characters: ${named.length}`);

  // Print first 5 for inspection
  for (const r of named.slice(0, 5)) {
    console.log(`  ${r.firstName} ${r.lastName} age=${r.age} role=${r.role} offset=0x${r.offset.toString(16)} traits=${r.traits.length}`);
  }

  if (named.length < 5) {
    console.log("Not enough records to dig; aborting.");
    return;
  }

  // For each byte offset 0..540, gather values across all named records
  const N = named.length;
  const RANGE = 540;
  // Known offsets to exclude
  const excluded = new Set();
  const ranges = [
    [0, 4], [4, 1], [5, 4], [9, 1], [18, 8], [26, 1], [30, 4], [34, 1],
    [42, 1], [46, 4], [54, 16], [86, 2], [302, 2],
  ];
  for (const [start, len] of ranges) {
    for (let k = 0; k < len; k++) excluded.add(start + k);
  }

  // u8 candidates
  const u8stats = [];
  for (let off = 0; off < RANGE; off++) {
    if (excluded.has(off)) continue;
    const vals = [];
    for (const r of named) {
      if (r.offset + off >= buf.length) continue;
      // Skip if this offset falls into the trait block (variable length)
      const traitsStart = 308;
      if (off >= traitsStart && off < traitsStart + r.traits.length * 8 + 16) continue;
      vals.push(buf[r.offset + off]);
    }
    if (vals.length < 5) continue;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const distinct = new Set(vals).size;
    if (distinct < 3) continue;
    if (max > 20) continue; // mood/loyalty/influence rarely exceed 10-20
    const inRange010 = vals.filter(v => v >= 0 && v <= 10).length;
    const score = inRange010 / vals.length;
    if (score < 0.85) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    u8stats.push({ off, distinct, min, max, mean: mean.toFixed(2), n: vals.length, score: score.toFixed(2), sample: vals.slice(0, 8) });
  }

  u8stats.sort((a, b) => b.distinct - a.distinct);
  console.log(`\nu8 candidates (range 0..540, varied, in 0..10 range):`);
  for (const s of u8stats.slice(0, 40)) {
    console.log(`  +${s.off.toString().padStart(3)}  distinct=${s.distinct}  min=${s.min}  max=${s.max}  mean=${s.mean}  n=${s.n}  score=${s.score}  sample=[${s.sample.join(",")}]`);
  }

  // For top candidates, dump per-character values aligned with names + key traits
  console.log(`\n=== Per-character values for top 10 candidates ===`);
  const topOffsets = u8stats.slice(0, 10).map(s => s.off);
  console.log(`name(age)\trole\ttraits\t${topOffsets.map(o => "+" + o).join("\t")}`);
  for (const r of named.slice(0, 30)) {
    const traitSummary = r.traits.map(t => t.name + (t.level > 1 ? t.level : "")).slice(0, 5).join(",");
    const vals = topOffsets.map(o => buf[r.offset + o]);
    console.log(`${r.firstName.slice(0, 10)} ${(r.lastName || "").slice(0, 10)}(${r.age})\t${r.role}\t${traitSummary.slice(0, 40)}\t${vals.join("\t")}`);
  }

  // Save full table for analysis
  const dumpPath = path.join(PROVINCIA, "scripts", "save-cracker", "mood-dig-1.json");
  fs.writeFileSync(dumpPath, JSON.stringify({ records: named.length, u8: u8stats.slice(0, 60) }, null, 2));
  console.log(`\nWrote ${dumpPath}`);
}

main();
