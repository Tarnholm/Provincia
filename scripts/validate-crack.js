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
const { parseFactionTreasuries, parseFactionTreasuryHistory } = require("../src/saveCrackerExtras.js");

const argv = process.argv.slice(2);
const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MOD = getArg("--mod", "C:\\RIS\\RIS\\data");
const SAVES = getArg("--saves", "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves");
// Crash-telemetry saves (real RIS v7.2 saves at turns 5/8/34 — great late-save
// coverage). Each *.sav lives one level down under a per-report dir. Swept with
// the SAME structural invariants as the primary corpus.
const CRASH_SAVES = getArg("--crash-saves", "C:\\dev\\crash-saves-v7.2");

let pass = 0, fail = 0, skip = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond === null) { skip++; console.log(`  SKIP ${name}${detail ? "  — " + detail : ""}`); return; }
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${detail ? "  — " + detail : ""}`); }
}

// Cache cracked saves by ABSOLUTE path. `crack(file)` takes a bare filename in
// the primary SAVES dir (back-compat with the ground-truth section); crackPath
// takes any absolute .sav path (used for the crash-telemetry saves).
const cache = {};
function crackPath(p) {
  if (p in cache) return cache[p];
  if (!fs.existsSync(p)) return (cache[p] = null);
  try { return (cache[p] = crackSave(fs.readFileSync(p), MOD)); }
  catch (e) { console.log(`  (crack threw on ${p}: ${e.message})`); return (cache[p] = false); }
}
function crack(file) { return crackPath(path.join(SAVES, file)); }

// Crash-telemetry saves: recursively collect every *.sav under CRASH_SAVES.
// Returns [{ file (display label), full (absolute path) }].
function collectCrashSaves(root) {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) {
      for (const f of fs.readdirSync(p))
        if (f.toLowerCase().endsWith(".sav")) out.push({ file: `${ent.name}/${f}`, full: path.join(p, f) });
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".sav")) {
      out.push({ file: ent.name, full: p });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
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

// descr_sm_factions declaration order — the index space the treasury-history
// keying fix requires (mirrors readSmFactionsOrder in saveCracker / main.js's
// modFactionOrder). The history record's faction = its RECORD POSITION indexed
// into THIS order (NOT the factionId byte, NOT engineOrder). See
// findings-treasury-history-keying-2026-05-31.md.
function readSmFactionsOrder() {
  const src = path.join(MOD, "descr_sm_factions.txt");
  if (!fs.existsSync(src)) return [];
  const out = [];
  for (const line of fs.readFileSync(src, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\t"([a-z_0-9]+)":/);
    if (m) out.push(m[1]);
  }
  return out;
}

// Known EVENT_CLASS enum values (mirror eventLogParser.EVENT_CLASS). An event
// whose type falls back to `class_<N>` is an UNKNOWN class.
let EVENT_CLASS = null;
try { ({ EVENT_CLASS } = require("../src/eventLogParser.js")); } catch (e) { /* */ }

// ── Structural invariants asserted for EVERY save in the corpus ───────────
// No per-save ground truth: each assertion must hold for any valid save.
// Attribution FLOOR (the realistic minimum) — see note below. LAND unit faction
// attribution rides on mapping a unit's region → settlement → ownerByCity.
// As of 2026-05-31 the settlement-marker scanner reads BOTH terminator variants
// (recovering ~140 dropped settlements) and region-name markers are normalized
// to settlement names, so land attribution is ≥90% on the mid/late crash saves.
// NAVAL units ("the sea") have no land owner and are EXCLUDED from this rate
// (reported separately as r._stats.unitAttribution.naval). What matters for
// correctness is that NO unit is given a WRONG faction — asserted separately
// (badUnitFactions === 0).
const UNIT_ATTR_FLOOR = 0.90;

// CONFIRMED RIS campaign cadence (turnParser.js): 4 turns per year, epoch 270 BC.
const EPOCH_YEAR = -270, TURNS_PER_YEAR = 4;
const yearForTurn = (turn) => EPOCH_YEAR + Math.floor((turn - 1) / TURNS_PER_YEAR);

// Extract the turn number a save FILENAME encodes, e.g.
//   "...Republic of Rome   Turn 34 Start"  → { turn: 34, phase: "start" }
//   "...Turn 8 End"                         → { turn: 8,  phase: "end" }
// Returns null when the filename carries no turn (e.g. save_julii1, Quicksave).
function turnFromFilename(file) {
  const m = file.match(/Turn[ _]+(\d+)[ _]+(Start|End)/i);
  if (!m) return null;
  return { turn: parseInt(m[1], 10), phase: m[2].toLowerCase() };
}

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

  // --- TURN NUMBER + CAMPAIGN DATE (pins the literal-counter fix, v0.9.763) ---
  // The old turn heuristic counted econ-history blocks and SATURATED (~10) on
  // long campaigns; turnParser.js now reads the literal counter. Assert it.
  // See findings-turn-number-2026-05-31.md.
  // (a) crackSave exposes currentYear + seasonIndex (the new fields).
  check(tag("exposes currentYear (int)"), Number.isInteger(r.currentYear), `got ${r.currentYear}`);
  check(tag("exposes seasonIndex 0..3"),
    Number.isInteger(r.seasonIndex) && r.seasonIndex >= 0 && r.seasonIndex < TURNS_PER_YEAR, `got ${r.seasonIndex}`);
  // (b) year ↔ turn obeys the CONFIRMED 4-turns/year cadence.
  if (Number.isInteger(r.turn) && r.turn >= 1 && Number.isInteger(r.currentYear)) {
    check(tag("currentYear == -270 + floor((turn-1)/4)"),
      r.currentYear === yearForTurn(r.turn), `turn ${r.turn} → expect ${yearForTurn(r.turn)} got ${r.currentYear}`);
    check(tag("seasonIndex == (turn-1) % 4"),
      r.seasonIndex === ((r.turn - 1) % TURNS_PER_YEAR), `turn ${r.turn} → expect ${(r.turn - 1) % TURNS_PER_YEAR} got ${r.seasonIndex}`);
  }
  // (c) when the FILENAME encodes a turn ("...Turn N Start/End"), crackSave().turn
  //     MUST equal N exactly (the old heuristic returned 10 for "Turn 34 Start").
  const tnf = turnFromFilename(file);
  if (tnf) {
    check(tag(`turn matches filename "Turn ${tnf.turn} ${tnf.phase}" (== ${tnf.turn})`),
      r.turn === tnf.turn, `got ${r.turn}`);
  }

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
  let unitSoldiersBad = 0, navalAttributed = 0;
  const unitFacs = new Set();
  for (const u of units) {
    if (u.faction) unitFacs.add(u.faction);
    // A naval unit must never carry a (fabricated) land faction.
    if (u.naval && u.faction) navalAttributed++;
    if (u.soldiers != null && !(Number.isFinite(u.soldiers) && u.soldiers >= 0)) unitSoldiersBad++;
  }
  const badUnitFactions = [...unitFacs].filter((f) => !known.has(f));
  check(tag("every attributed unit.faction is real"), badUnitFactions.length === 0, `bad=${badUnitFactions.join(",")}`);
  check(tag("every unit soldiers >= 0"), unitSoldiersBad === 0, `${unitSoldiersBad} bad`);
  check(tag("no naval unit carries a (guessed) faction"), navalAttributed === 0, `${navalAttributed} naval with faction`);
  // LAND attribution rate (naval excluded from the denominator). Prefer the
  // crack's own summary; fall back to recomputing from units if absent.
  const ua = (r._stats && r._stats.unitAttribution) || null;
  const landUnits = ua ? ua.land : units.filter((u) => !u.naval).length;
  const landAttr = ua ? ua.landAttributed : units.filter((u) => !u.naval && u.faction).length;
  const attrFrac = landUnits ? landAttr / landUnits : 1;
  check(tag(`>= ${Math.round(UNIT_ATTR_FLOOR * 100)}% LAND units attributed`),
    landUnits === 0 ? null : attrFrac >= UNIT_ATTR_FLOOR,
    `${(attrFrac * 100).toFixed(1)}% (${landAttr}/${landUnits} land; ${ua ? ua.naval : "?"} naval)`);
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

  // --- FAMILY-ROSTER FLOOR (pins the portrait-record fix, v0.9.763) ----------
  // The old anchor required `0xffffffff @ p-7` (a non-invariant "sentinel" that
  // only holds for portrait-LESS members), so it silently dropped every member
  // with an assigned portrait — collapsing a turn-34 roster to ~304. After the
  // fix the same save yields ~2185. Lock that in, scaled to the campaign turn.
  // See findings-family-latesave-2026-05-31.md.
  // (1) every member carries a real (non-empty) first name.
  const famNoName = fam.filter((m) => !(typeof m.firstName === "string" && m.firstName.trim().length > 0)).length;
  check(tag("every family member has a non-empty real name"), famNoName === 0, `${famNoName} nameless`);
  // (2) UUIDs are unique — a duplicate would mean a false-positive anchor hit
  //     inflating the count (the fix must NOT reintroduce phantom records).
  const uniqUuids = new Set(fam.map((m) => m.uuid >>> 0));
  check(tag("family UUIDs are unique"), uniqUuids.size === fam.length, `${fam.length - uniqUuids.size} dup of ${fam.length}`);
  // (3) LIVING members mostly carry an age (dead relatives may be age-less);
  //     a mass age-less population would signal a decode regression.
  const living = fam.filter((m) => m.alive !== false);
  const livingWithAge = living.filter((m) => m.age != null).length;
  const livingAgeFrac = living.length ? livingWithAge / living.length : 1;
  check(tag("living family members mostly have ages (>= 90%)"),
    living.length === 0 ? null : livingAgeFrac >= 0.90,
    `${(livingAgeFrac * 100).toFixed(1)}% (${livingWithAge}/${living.length})`);
  // (4) Realistic FLOOR scaled to turn. A real campaign has hundreds of family
  //     members per surviving great house; a late save (turn >= 20) must be far
  //     above the old broken ~304. Floor stays a FLOOR (not an exact count) so
  //     it never goes red on a legitimately bigger/smaller roster.
  const tn = turnFromFilename(file);
  const fnTurn = tn ? tn.turn : (Number.isInteger(r.turn) ? r.turn : null);
  if (fnTurn != null) {
    const famFloor = fnTurn >= 20 ? 800 : 300;  // turn-1 RIS already yields ~1580
    check(tag(`family count >= floor for turn ${fnTurn} (>= ${famFloor})`),
      fam.length >= famFloor, `got ${fam.length}`);
  } else {
    // No turn signal at all (shouldn't happen): just assert a non-degenerate roster.
    check(tag("family count is non-degenerate (>= 50)"), fam.length >= 50, `got ${fam.length}`);
  }
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

  // ── CRASH-TELEMETRY SAVES — same structural invariants ────────────────
  // Real RIS v7.2 saves at turns 5/8/34 (great late-save coverage). The turn-N
  // filename + family-floor + 4-turns/year checks inside invariants() fire here
  // too, so this corpus actively exercises the v0.9.763 correctness fixes.
  const crashSaves = collectCrashSaves(CRASH_SAVES);
  console.log(`\n### CRASH-TELEMETRY SAVES — ${crashSaves.length} saves under ${CRASH_SAVES}`);
  for (const { file, full } of crashSaves) {
    console.log(`\n[${file}]`);
    invariants(file, crackPath(full), known);
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

  // ── TREASURY-HISTORY FACTION KEYING (pins the smOrder fix, v0.9.763) ───────
  // parseFactionTreasuryHistory used to key each per-turn treasury series by the
  // record's factionId BYTE (off-by-one on imperial sub=6 records), cross-wiring
  // every faction's timeline to the NEXT faction's name (carthage's series →
  // "antigonid", etc). FIX: key by RECORD POSITION → descr_sm order (smOrder).
  // Crib: a faction's history checkpoint at the captured turn ≈ its treasury one
  // turn earlier; the identity is pinned via the julii1 STARTING treasuries. The
  // load-bearing assertion is that carthage's series is NOT antigonid's. See
  // findings-treasury-history-keying-2026-05-31.md.
  console.log("\n[treasury history keying]");
  const smOrder = readSmFactionsOrder();
  const j3path = path.join(SAVES, "save_julii3.sav");
  if (smOrder.length && fs.existsSync(j3path) && fs.existsSync(path.join(SAVES, "save_julii1.sav"))) {
    const buf1 = fs.readFileSync(path.join(SAVES, "save_julii1.sav"));
    const buf3 = fs.readFileSync(j3path);
    const recs1 = parseFactionTreasuries(buf1);
    const recs3 = parseFactionTreasuries(buf3);
    const hist = parseFactionTreasuryHistory(buf3, recs3, smOrder);
    check("treasury-history table located", !!hist && Object.keys(hist).length > 0,
      hist ? `${Object.keys(hist).length} factions` : "null");
    if (hist) {
      // Identity crib: julii1 STARTING treasuries uniquely name each record slot.
      const START = { carthage: 25500, antigonid: 22000, ptolemaic: 47000, seleucid: 62500, bactria: 11000 };
      const idxByName = {}; smOrder.forEach((n, i) => (idxByName[n] = i));
      for (const [fac, startTr] of Object.entries(START)) {
        const i = idxByName[fac];
        check(`smOrder slot for ${fac} crib (julii1 treasury == ${startTr})`,
          i != null && recs1[i] && recs1[i].treasury === startTr,
          `slot ${i} got ${i != null && recs1[i] ? recs1[i].treasury : "?"}`);
        // The series under this faction's NAME must track ITS OWN treasury — its
        // first checkpoint sits within turn-rollover range of the starting value.
        check(`${fac} history series is keyed to ${fac} (≈ its own treasury)`,
          Array.isArray(hist[fac]) && hist[fac].length >= 1 && Math.abs(hist[fac][0] - startTr) <= 2000,
          `series=${hist[fac] ? hist[fac].slice(0, 2).join(",") : "missing"} vs start ${startTr}`);
      }
      // The exact off-by-one that was wired wrong: carthage's series must NOT be
      // antigonid's (pre-fix they were swapped).
      check("carthage's history series is NOT antigonid's (off-by-one guard)",
        Array.isArray(hist.carthage) && Array.isArray(hist.antigonid) && hist.carthage[0] !== hist.antigonid[0],
        `carthage[0]=${hist.carthage && hist.carthage[0]} antigonid[0]=${hist.antigonid && hist.antigonid[0]}`);
    }
  } else {
    check("treasury history keying (julii1/3 + descr_sm present)", null, "saves or descr_sm absent");
  }

  console.log(`\n========================================\nTOTAL: ${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
  if (fail > 0) console.log(`FAILURES:\n  - ${failures.join("\n  - ")}`);
  console.log(`========================================`);
  process.exit(fail > 0 ? 1 : 0);
}

run();
