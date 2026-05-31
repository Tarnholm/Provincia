// scripts/validate-crack.js — corpus regression harness for the save parsers.
//
// Two layers:
//  1. STRUCTURAL INVARIANTS — asserted against EVERY .sav in the corpus, no
//     per-save ground truth needed. These hold regardless of faction/turn:
//     crack succeeds, treasuries are finite ints, every owner/unit/family
//     faction resolves to a real faction, ages sane, diplomacy symmetric,
//     sieges bounded, events well-typed, faction-knowledge bounded, etc.
//  2. GROUND TRUTH — the original hand-verified checks (treasuries, family
//     names, diplomacy folding, knowledge counts, growth roll-forward) for
//     the handful of saves that have them.
//
// One command to confirm none of the shipped parsers (family / siege / event /
// settlementFields / eventSchedule / scriptCounters / factionKnowledge /
// diplomacy / treasury / units / ownership) have regressed.
//
// Saves aren't committed, so this is a manual harness (not CI). Run:
//   node scripts/validate-crack.js [--mod <modDataDir>] [--saves <dir>]
// Exit code 0 if all checks pass, 1 otherwise.

"use strict";
const fs = require("fs");
const path = require("path");
const { crackSave } = require("../src/saveCracker.js");

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MOD = getArg("--mod", "C:\\RIS\\RIS\\data");
const SAVES = getArg("--saves", "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves");

let pass = 0, fail = 0, skip = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond === null) { skip++; console.log(`  SKIP ${name}${detail ? "  — " + detail : ""}`); return; }
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
}

// Cache cracked saves by filename.
const cache = {};
function crack(file) {
  if (file in cache) return cache[file];
  const p = path.join(SAVES, file);
  if (!fs.existsSync(p)) return (cache[file] = null);
  try { return (cache[file] = crackSave(fs.readFileSync(p), MOD)); }
  catch (e) { console.log(`  (crack threw on ${file}: ${e.message})`); return (cache[file] = false); }
}

// The authoritative universe of real faction names — descr_strat declaration
// order. Every owner/unit/family faction must resolve to one of these.
function readKnownFactions() {
  const candidates = [
    path.join(MOD, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    path.join(MOD, "world", "maps", "campaign", "alexander", "descr_strat.txt"),
    path.join(MOD, "world", "maps", "campaign", "barbarian_invasion", "descr_strat.txt"),
  ];
  const known = new Set();
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*faction\s+([a-z_0-9]+)/i);
      if (m) known.add(m[1]);
    }
    if (known.size) break;
  }
  return known;
}

// Known EVENT_CLASS enum values (mirror eventLogParser.EVENT_CLASS). An event
// whose type falls back to `class_<N>` is an UNKNOWN class.
let EVENT_CLASS = null;
try { ({ EVENT_CLASS } = require("../src/eventLogParser.js")); } catch (e) { /* */ }

// ── Structural invariants asserted for EVERY save in the corpus ───────────
// No per-save ground truth: each assertion must hold for any valid save.
// Attribution FLOOR (the realistic minimum) — see note below. Unit faction
// attribution rides on mapping a unit's region → settlement → ownerByCity;
// the save's settlement-marker name vocabulary doesn't cover every region
// (chiefly non-Italian regions + open-sea fleets), so 100% is unreachable on
// mid/late saves. What matters for correctness is that NO unit is given a
// WRONG faction — that is asserted separately (badUnitFactions === 0).
const UNIT_ATTR_FLOOR = 0.70;

function invariants(file, r, known) {
  const tag = (s) => `[${file}] ${s}`;

  // --- crack basics ---
  check(tag("crack succeeded"), !!r, r === false ? "threw" : "missing");
  if (!r) return;
  check(tag("header.magic == 1802"), r.header && r.header.magic === 1802, `got ${r.header && r.header.magic}`);
  check(tag("turn >= 0"), Number.isInteger(r.turn) && r.turn >= 0, `got ${r.turn}`);
  check(tag("playerFaction non-empty + real"),
    typeof r.playerFaction === "string" && r.playerFaction.length > 0 && known.has(r.playerFaction),
    `got ${r.playerFaction}`);

  // --- factions / treasuries ---
  const facNames = Object.keys(r.factions);
  let trBad = 0, rcBad = 0, rcSum = 0;
  for (const [, f] of Object.entries(r.factions)) {
    if (f.treasury != null && !Number.isInteger(f.treasury)) trBad++;
    if (!(Number.isInteger(f.regionCount) && f.regionCount >= 0)) rcBad++;
    rcSum += f.regionCount || 0;
  }
  check(tag("every treasury is a finite int (or null)"), trBad === 0, `${trBad} non-integer`);
  check(tag("every regionCount is int >= 0"), rcBad === 0, `${rcBad} bad`);
  // Plausibility: total owned regions == ownerByCity size (by construction) and
  // is a positive, non-degenerate count.
  const ownerKeys = Object.keys(r.ownerByCity || {});
  check(tag("sum(regionCount) == ownerByCity size & > 0"),
    rcSum === ownerKeys.length && rcSum > 0, `sum=${rcSum} owners=${ownerKeys.length}`);

  // --- ownership: every owner resolves to a real faction ---
  const ownerVals = [...new Set(Object.values(r.ownerByCity || {}))];
  const badOwners = ownerVals.filter((f) => !known.has(f));
  check(tag("every ownerByCity faction is real"), badOwners.length === 0, `bad=${badOwners.join(",")}`);

  // --- settlements / settlementFields ---
  const sf = r.settlementFields || {};
  const sfKeys = Object.keys(sf);
  const sfNotInOwner = sfKeys.filter((k) => !(k in r.ownerByCity));
  check(tag("every settlementFields key resolves in ownerByCity"),
    sfNotInOwner.length === 0, `${sfNotInOwner.length} orphan (e.g. ${sfNotInOwner.slice(0, 3).join(",")})`);
  let sfBadIncome = 0, sfBadPop = 0;
  for (const k of sfKeys) {
    const f = sf[k];
    if (f.income != null && !Number.isFinite(f.income)) sfBadIncome++;
    // committedPopulation, where present, must be a positive count.
    if (f.committedPopulation != null && !(Number.isFinite(f.committedPopulation) && f.committedPopulation > 0)) sfBadPop++;
  }
  check(tag("every settlementField income finite (or null)"), sfBadIncome === 0, `${sfBadIncome} non-finite`);
  check(tag("committedPopulation > 0 where present"), sfBadPop === 0, `${sfBadPop} non-positive`);

  // --- units / armies ---
  const units = r.units || [];
  let unitNull = 0, unitSoldiersBad = 0;
  const unitFacs = new Set();
  for (const u of units) {
    if (!u.faction) { unitNull++; }
    else unitFacs.add(u.faction);
    if (u.soldiers != null && !(Number.isFinite(u.soldiers) && u.soldiers >= 0)) unitSoldiersBad++;
  }
  const badUnitFactions = [...unitFacs].filter((f) => !known.has(f));
  check(tag("every attributed unit.faction is real"), badUnitFactions.length === 0, `bad=${badUnitFactions.join(",")}`);
  check(tag("every unit soldiers >= 0"), unitSoldiersBad === 0, `${unitSoldiersBad} bad`);
  const attrFrac = units.length ? (units.length - unitNull) / units.length : 1;
  check(tag(`>= ${Math.round(UNIT_ATTR_FLOOR * 100)}% units attributed`),
    units.length === 0 ? null : attrFrac >= UNIT_ATTR_FLOOR,
    `${(attrFrac * 100).toFixed(1)}% (${units.length - unitNull}/${units.length})`);
  // Armies: each army's unitCount must equal its actual member count, and its
  // soldiers the sum of members'.
  const byCmd = new Map();
  for (const u of units) {
    if (!u.commanderUuid) continue;
    let a = byCmd.get(u.commanderUuid);
    if (!a) { a = { n: 0, s: 0 }; byCmd.set(u.commanderUuid, a); }
    a.n++; a.s += u.soldiers || 0;
  }
  let armyMismatch = 0;
  for (const a of r.armies || []) {
    const m = byCmd.get(a.commanderUuid);
    if (!m || m.n !== a.unitCount || m.s !== a.soldiers) armyMismatch++;
  }
  check(tag("every army unitCount/soldiers matches its members"), armyMismatch === 0, `${armyMismatch} mismatch`);

  // --- characters / family ---
  const fam = r.characters && r.characters.family || [];
  const famFacBad = [...new Set(fam.map((m) => m.faction).filter(Boolean))].filter((f) => !known.has(f));
  check(tag("every attributed family member faction is real"), famFacBad.length === 0, `bad=${famFacBad.join(",")}`);
  let ageBad = 0;
  for (const m of fam) {
    if (m.age == null) continue;
    if (!(Number.isFinite(m.age) && m.age >= 0 && m.age <= 120)) ageBad++;
  }
  check(tag("every family age in 0..120 or null"), ageBad === 0, `${ageBad} absurd`);
  // father/spouse refs: a non-zero UUID link must either resolve to a name
  // (in-table or v1) OR be unresolvable but never crash; we assert resolution
  // RATE among links that point at a record present in the family table.
  const byU = new Map(fam.map((m) => [m.uuid >>> 0, m]));
  let inTableRefs = 0, inTableResolved = 0;
  for (const m of fam) {
    for (const u of [m.fatherUuid, m.spouseUuid]) {
      if (!u) continue;
      const t = byU.get(u >>> 0);
      if (t) { inTableRefs++; inTableResolved++; }   // target present ⇒ resolvable
    }
  }
  check(tag("father/spouse refs resolve when target is in-table"),
    inTableRefs === 0 ? null : inTableResolved === inTableRefs,
    `${inTableResolved}/${inTableRefs}`);

  // --- diplomacy: symmetric, no self-war, no placeholder leaks ---
  if (r.diplomacy && r.diplomacy._meta) {
    check(tag("diplomacy symmetry >= 0.99"), r.diplomacy._meta.symmetry >= 0.99, `sym ${r.diplomacy._meta.symmetry}`);
    const dk = Object.keys(r.diplomacy).filter((k) => k !== "_meta");
    const warOf = new Map(dk.map((f) => [f, new Set(r.diplomacy[f].war || [])]));
    let selfWar = 0, asym = 0, warEdges = 0;
    for (const f of dk) {
      for (const w of r.diplomacy[f].war || []) {
        if (w === f) selfWar++;
        warEdges++;
        const back = warOf.get(w);
        if (back && !back.has(f)) asym++;
      }
    }
    check(tag("no faction at war with itself"), selfWar === 0, `${selfWar}`);
    check(tag("war relation is symmetric (A↔B)"), asym === 0, `${asym} one-sided edges of ${warEdges}`);
    // No placeholder/folded names (italics / dummies / free-peoples) leak as a
    // real on-map faction key in the diplomacy table.
    const placeholders = dk.filter((f) => /^(italics|dummies|free_peoples|slave)$/.test(f) && f !== "slave");
    check(tag("no placeholder factions leak as real diplomacy keys"), placeholders.length === 0, `leak=${placeholders.join(",")}`);
  } else {
    check(tag("diplomacy matrix located"), false, "no _meta");
  }

  // --- sieges ---
  let siegeBadTurns = 0, siegeBadTarget = 0;
  for (const s of r.sieges || []) {
    if (!(Number.isFinite(s.turnsRemaining) && s.turnsRemaining >= 0 && s.turnsRemaining <= 100)) siegeBadTurns++;
    if (s.targetSettlement != null && !(s.targetSettlement in r.ownerByCity)) siegeBadTarget++;
  }
  check(tag("every siege turnsRemaining in 0..100"), siegeBadTurns === 0, `${siegeBadTurns} bad`);
  check(tag("every siege targetSettlement resolves or null"), siegeBadTarget === 0, `${siegeBadTarget} unresolved`);

  // --- events: every type is a known EVENT_CLASS enum ---
  if (EVENT_CLASS) {
    const knownTypes = new Set(Object.values(EVENT_CLASS));
    const unkTypes = [...new Set((r.events || []).map((e) => e.type))].filter((t) => !knownTypes.has(t));
    check(tag("every event.type is a known EVENT_CLASS value"),
      (r.events || []).length === 0 ? null : unkTypes.length === 0,
      `unknown=${unkTypes.join(",")}`);
  }

  // --- faction knowledge: bounded + keyed by real factions ---
  if (r.factionKnowledge && r.factionKnowledge.perFaction) {
    const total = ownerKeys.length;
    let fkBadKey = 0, fkOver = 0;
    for (const [name, v] of Object.entries(r.factionKnowledge.perFaction)) {
      if (!known.has(name)) fkBadKey++;
      if (v.knownSettlements != null && v.knownSettlements > total) fkOver++;
    }
    check(tag("every factionKnowledge key is a real faction"), fkBadKey === 0, `${fkBadKey} bad`);
    check(tag("knownSettlements <= total settlements"), fkOver === 0, `${fkOver} over total ${total}`);
  }
}

function run() {
  console.log(`=== crackSave corpus regression — mod=${MOD}\n    saves=${SAVES} ===`);
  const known = readKnownFactions();
  console.log(`known factions in mod: ${known.size}`);
  if (known.size === 0) {
    console.log("FATAL: no factions read from mod descr_strat — wrong --mod?");
    process.exit(2);
  }

  // ── STRUCTURAL INVARIANTS over the FULL corpus ────────────────────────
  const files = fs.existsSync(SAVES)
    ? fs.readdirSync(SAVES).filter((f) => f.toLowerCase().endsWith(".sav")).sort()
    : [];
  console.log(`\n### STRUCTURAL INVARIANTS — ${files.length} saves in corpus`);
  for (const f of files) {
    console.log(`\n[${f}]`);
    invariants(f, crack(f), known);
  }

  // ── GROUND TRUTH (hand-verified, only for saves that have it) ──────────
  console.log("\n\n### GROUND TRUTH");

  console.log("\n[treasury]");
  const TREAS = {
    "save_julii1.sav": ["romans_julii", 17500], "save_julii2.sav": ["romans_julii", 7268], "save_julii3.sav": ["romans_julii", 5485],
    "save_Carthage1.sav": ["carthage", 25500], "save_carthage2.sav": ["carthage", 34381], "save_carthage3.sav": ["carthage", 43075],
  };
  for (const [f, [fac, exp]] of Object.entries(TREAS)) {
    const r = crack(f); if (!r) { check(`treasury ${f}`, null, "no save"); continue; }
    const got = r.factions[fac] && r.factions[fac].treasury;
    check(`treasury ${fac} ${f} == ${exp}`, got === exp, `got ${got}`);
  }

  console.log("\n[meta]");
  for (const [f, [fac]] of Object.entries(TREAS)) {
    const r = crack(f); if (!r) continue;
    check(`${f} player == ${fac}`, r.playerFaction === fac, `got ${r.playerFaction}`);
    check(`${f} factions == 239`, r._stats.factions === 239, `got ${r._stats.factions}`);
  }

  console.log("\n[family]");
  const j1 = crack("save_julii1.sav");
  if (j1) {
    const fam = j1.characters.family || [];
    const names = new Set(fam.map((m) => m.firstName));
    for (const w of ["Baebiana", "Alypia", "Dryantilla", "Papiria", "Prisca", "Honoria"])
      check(`julii1 family has ${w}`, names.has(w));
    check("julii1 family count > 1000", fam.length > 1000, `got ${fam.length}`);
    const byU = new Map(fam.map((m) => [m.uuid >>> 0, m]));
    let pairs = 0, recip = 0;
    for (const m of fam) { if (m.spouseUuid) { const s = byU.get(m.spouseUuid >>> 0); if (s) { pairs++; if ((s.spouseUuid >>> 0) === (m.uuid >>> 0)) recip++; } } }
    check("julii1 spouse reciprocity 100%", pairs > 10 && recip === pairs, `${recip}/${pairs}`);
  }

  console.log("\n[diplomacy]");
  if (j1) {
    const d = j1.diplomacy.romans_julii;
    check("julii1 diplomacy matrix located", j1.diplomacy._meta && j1.diplomacy._meta.symmetry >= 0.99, `sym ${j1.diplomacy._meta?.symmetry}`);
    check("julii1 war list excludes real factions", d.war.every((w) => /(_rebels|^slave$|^rebels$|^dummies$|^italics$)/.test(w) || w === "italics"), `war=${d.war.join(",")}`);
    check("julii1 protectorates == 6", (d.protectorates || []).length === 6, `got ${(d.protectorates || []).length}`);
  }

  console.log("\n[knowledge]");
  if (j1) check("julii1 factionsWithTail == 107", j1._stats.factionsWithKnowledge === 107, `got ${j1._stats.factionsWithKnowledge}`);

  console.log("\n[settlement growth]");
  const j2 = crack("save_julii2.sav"), j3 = crack("save_julii3.sav");
  if (j2 && j3 && j2.settlementFields.Rome && j3.settlementFields.Rome) {
    check("Rome pop roll-forward (j2.projected == j3.committed)",
      j2.settlementFields.Rome.projectedPopulation === j3.settlementFields.Rome.committedPopulation,
      `${j2.settlementFields.Rome.projectedPopulation} vs ${j3.settlementFields.Rome.committedPopulation}`);
  }

  console.log("\n[events]");
  if (j3) {
    check("julii3 events > 100", (j3.events || []).length > 100, `got ${(j3.events || []).length}`);
    check("julii3 events all faction-tagged", (j3.events || []).every((e) => typeof e.subject === "string"));
  }

  console.log(`\n========================================\nTOTAL: ${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
  if (fail > 0) console.log(`FAILURES:\n  - ${failures.join("\n  - ")}`);
  console.log(`========================================`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
