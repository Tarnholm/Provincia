// dig-charrec-effect-map.js
// Map the per-character "effect-array" u32 slots to named RTW Effects by
// correlating, across all characters in a save, each byte-slot value against
// the EXPECTED total effect contribution computed from the character's traits
// (parsed from export_descr_character_traits.txt level thresholds + Effect lines).
//
// For each trait LEVEL we know the cumulative Effect bonuses the trait grants.
// Summing across a char's traits gives expected {effectName: total}. We then
// find which record byte-slot (u32 LE, offset +94..+300) equals that expected
// total for the MOST characters. A slot that matches an effect for ~all chars
// is that effect's storage slot.
const fs = require("fs");
const path = require("path");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traitsTxt = fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8");

// ---- Parse traits file: Trait -> [ {threshold, effects:{name:val}} per level ] ----
// Format:
//   Trait <Name>
//       Characteristic <...>
//       Level <LevelName>
//           Description ...
//           EffectsDescription ...
//           Threshold <N>
//           Effect <EffName> <int>
//           Effect ...
//       Level <...>
const traitNames = [];
const traitDef = new Map(); // name -> [{threshold, effects:[{name,val}]}]
{
  const lines = traitsTxt.split(/\r?\n/);
  let curTrait = null, curLevel = null;
  for (let raw of lines) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^Trait\s+([A-Za-z0-9_]+)/))) {
      curTrait = m[1]; traitNames.push(curTrait); traitDef.set(curTrait, []); curLevel = null;
    } else if (curTrait && (m = line.match(/^Level\s+([A-Za-z0-9_]+)/))) {
      curLevel = { threshold: null, effects: [] }; traitDef.get(curTrait).push(curLevel);
    } else if (curLevel && (m = line.match(/^Threshold\s+(\d+)/))) {
      curLevel.threshold = parseInt(m[1], 10);
    } else if (curLevel && (m = line.match(/^Effect\s+([A-Za-z0-9_]+)\s+(-?\d+)/))) {
      curLevel.effects.push({ name: m[1], val: parseInt(m[2], 10) });
    }
  }
}

// trait id index = position in traitNames (matches characterParser)
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(SAVE);
const v1 = findCharacterRecords(buf, names, traitNames, null);
console.log(`SAVE=${path.basename(SAVE)} v1=${v1.length}  distinctTraits=${traitNames.length}`);

// Given a trait name + POINTS, determine the active level (highest threshold <= points)
// and return the cumulative effects of that level (RTW effects are absolute per level,
// not additive — the active level's Effect lines are the total for that trait).
function effectsFor(name, points) {
  const def = traitDef.get(name);
  if (!def || def.length === 0) return null;
  // levels are in order; threshold ascending. pick highest threshold <= points.
  let chosen = null;
  for (const lvl of def) {
    const th = lvl.threshold == null ? 0 : lvl.threshold;
    if (points >= th) chosen = lvl; else break;
  }
  if (!chosen) chosen = def[0];
  return chosen.effects;
}

// Build per-char expected effect totals
const EFFECT_NAMES = new Set();
const charExpected = []; // {char, expected:Map(eff->total)}
for (const c of v1) {
  const exp = new Map();
  for (const t of (c.traits||[])) {
    const effs = effectsFor(t.name, t.points);
    if (!effs) continue;
    for (const e of effs) {
      exp.set(e.name, (exp.get(e.name)||0) + e.val);
      EFFECT_NAMES.add(e.name);
    }
  }
  charExpected.push({ c, exp });
}

// For each byte-slot (offset +94..+298 step 4) read u32->s32 for each char.
// For each (slot, effectName) count how many chars have slotValue == expected.
// Only consider chars that HAVE that effect (expected != 0) OR all chars.
const SLOTS = [];
for (let p = 94; p <= 298; p += 4) SLOTS.push(p);

const results = []; // {effect, slot, matchAll, totalAll, matchNZ, totalNZ}
for (const eff of EFFECT_NAMES) {
  // chars where expected for eff is defined (nonzero)
  for (const p of SLOTS) {
    let matchAll = 0, totalAll = 0, matchNZ = 0, totalNZ = 0;
    for (const { c, exp } of charExpected) {
      const lb = c.lastName === null;
      const off = c.offset + p + (lb ? -4 : 0); // align LAYOUT_A to LAYOUT_B raw offset? No: we want raw record offset. Keep p as raw LAYOUT_B; for A add +4.
      // We want the same physical field. LAYOUT_A fields are +4 vs LAYOUT_B.
      const physOff = lb ? (c.offset + p) : (c.offset + p + 4);
      if (physOff + 4 > buf.length) continue;
      const val = buf.readInt32LE(physOff);
      const e = exp.get(eff) || 0;
      totalAll++;
      if (val === e) matchAll++;
      if (e !== 0) { totalNZ++; if (val === e) matchNZ++; }
    }
    results.push({ eff, slot: p, matchAll, totalAll, matchNZ, totalNZ,
      rateNZ: totalNZ ? matchNZ/totalNZ : 0, rateAll: totalAll ? matchAll/totalAll : 0 });
  }
}

// For each effect, report the best slot by NZ match rate (need >=5 NZ samples)
console.log("\n=== Best slot per effect (>=5 nonzero-expected chars, rateNZ desc) ===");
const byEff = new Map();
for (const r of results) {
  if (r.totalNZ < 5) continue;
  if (!byEff.has(r.eff) || byEff.get(r.eff).rateNZ < r.rateNZ) byEff.set(r.eff, r);
}
const sorted = [...byEff.values()].sort((a,b)=>b.rateNZ-a.rateNZ);
for (const r of sorted) {
  if (r.rateNZ < 0.5) continue;
  console.log(`  slot +${r.slot}  <-  ${r.eff.padEnd(22)} rateNZ=${(r.rateNZ*100).toFixed(0)}% (${r.matchNZ}/${r.totalNZ})  rateAll=${(r.rateAll*100).toFixed(0)}%`);
}
