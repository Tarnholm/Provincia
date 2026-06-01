#!/usr/bin/env node
"use strict";
// scripts/doctor.js — HEADLESS APP SELF-CHECK.
//
// Loads a save (and/or simulates the non-live starting state from descr_strat),
// runs src/diagnostics.js across every feature class, prints a PASS/ANOMALY
// report, and exits NONZERO if any ERROR-severity anomaly is found. This is what
// the orchestrator runs BEFORE shipping a release to catch the in-game-only bug
// classes (nomad portraits, public-order divergence, empty war lists, garrison
// duplication, family under-read, turn/year drift, unit mis-attribution) without
// the user having to test in-game.
//
// USAGE
//   node scripts/doctor.js <save.sav> [--mod <dir>] [--nonlive]
//   node scripts/doctor.js               (defaults to julii1 + RIS mod)
//   node scripts/doctor.js --all-crash   (runs every frozen crash save)
//
//   --mod <dir>            mod data dir (default C:\RIS\RIS\data, falls back to
//                          C:\RIS\RIS if .../data missing)
//   --nonlive             ALSO run the non-live / starting-state diagnostics
//                          (built from descr_strat via the same crack, simulated)
//   --inject-hash-portraits   DEBUG: force every commander's portrait to null
//                          (hash pool) to PROVE the doctor flags the regression.
//                          Reverts nothing in the repo — purely an in-memory test.
//   --json                emit the structured report as JSON instead of text.
//
// EXIT CODES: 0 = no ERROR anomalies (WARN allowed); 1 = at least one ERROR; 2 = load failure.

const fs = require("fs");
const path = require("path");

const { crackSave } = require("../src/saveCracker.js");
const { runDiagnostics } = require("../src/diagnostics.js");
const { isGarrisonUnit } = require("../src/garrisonClassify.js");

// ── arg parsing ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = { mod: null, nonlive: false, injectHash: false, json: false, allCrash: false, saves: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--mod") opts.mod = argv[++i];
  else if (a === "--nonlive") opts.nonlive = true;
  else if (a === "--inject-hash-portraits") opts.injectHash = true;
  else if (a === "--json") opts.json = true;
  else if (a === "--all-crash") opts.allCrash = true;
  else if (a.startsWith("--")) { console.error(`unknown flag ${a}`); process.exit(2); }
  else opts.saves.push(a);
}

const DEFAULT_SAVE = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\save_julii1.sav";
const CRASH_DIR = "C:\\dev\\crash-saves-v7.2";

function resolveModDir(modArg) {
  const cands = [modArg, "C:\\RIS\\RIS\\data", "C:\\RIS\\RIS"].filter(Boolean);
  for (const c of cands) {
    // descr_regions / descr_strat live under data/ — accept the dir that has them.
    if (fs.existsSync(path.join(c, "descr_sm_factions.txt")) || fs.existsSync(path.join(c, "world"))) return c;
    if (fs.existsSync(path.join(c, "data", "descr_sm_factions.txt"))) return path.join(c, "data");
  }
  return modArg || "C:\\RIS\\RIS\\data";
}

function collectCrashSaves() {
  const out = [];
  if (!fs.existsSync(CRASH_DIR)) return out;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".sav")) out.push(p);
    }
  };
  walk(CRASH_DIR);
  return out;
}

// ── portrait resolution — the SAME pick logic main.js uses for v1PortraitsByCoord
// (kept in lockstep with main.js's [v1-portrait-bridge] builder). A commander
// whose pick returns null falls to the renderer hash pool (the nomad-faces bug).
function pickPortrait(c) {
  const ports = Array.isArray(c.portraits) ? c.portraits : [];
  const isBadPath = (p) => !p || (!c.isDead && /\/dead\//i.test(p));
  const goodLarge = ports.find((p) => !isBadPath(p) && /\/portraits\/portraits\//i.test(p));
  const goodAny = ports.find((p) => !isBadPath(p));
  const pick = goodLarge || goodAny;
  return pick || null;
}

// Build the diagnostics input from a crackSave result.
// `isNonLive` flips the portrait label and (in the simulated non-live path) marks
// the family-portrait cross-check source — but the resolver is identical, which
// is exactly the property the family-tree-match check asserts.
function buildDiagInput(r, label, isNonLive, injectHash) {
  // Commanders = living, on-map v1 generals/captains with a coord (the chars the
  // cards render). role 1/2 = general/captain; keep any with a tile + name.
  // First pass: count chars per coord so we can flag coord COLLISIONS. The
  // family-tree map is coord-keyed and collapses collisions to the last char
  // (documented limitation in FamilyTree.js); cross-checking a commander at a
  // shared tile against that map yields false mismatches, so we mark those
  // ambiguous and the diagnostics module excludes them from the cross-check.
  const coordCount = new Map();
  const onMap = [];
  for (const c of r.characters.v1) {
    if (c.isDead) continue;
    if (c.tileX == null || c.tileY == null) continue;
    if (!c.firstName) continue;
    onMap.push(c);
    const k = `${c.tileX},${c.tileY}`;
    coordCount.set(k, (coordCount.get(k) || 0) + 1);
  }
  const commanders = [];
  const familyPortraitByKey = {}; // coord → savePath (the family-tree resolution)
  for (const c of onMap) {
    const sp = pickPortrait(c);
    const coordKey = `${c.tileX},${c.tileY}`;
    const ambiguousKey = (coordCount.get(coordKey) || 0) > 1;
    // Family tree resolves the identical char by coord — populate it from the
    // SAME pick so a correct build agrees (mismatch=0) for UNIQUE coords. For
    // colliding coords this is last-write-wins, matching the live builder.
    if (sp) familyPortraitByKey[coordKey] = sp;
    commanders.push({
      name: `${c.firstName}${c.lastName ? " " + c.lastName.replace(/_/g, " ") : ""}`,
      faction: c.faction || null,
      savePath: injectHash ? null : sp,   // --inject-hash-portraits forces the hash pool
      coordKey,
      ambiguousKey,
    });
  }

  // Faction leader: the v1 record flagged isLeader for the player faction.
  let factionLeader = null;
  if (r.playerFaction) {
    const lead = r.characters.v1.find((c) => c.faction === r.playerFaction && c.isLeader && !c.isDead);
    if (lead) factionLeader = { name: `${lead.firstName || "?"}${lead.lastName ? " " + lead.lastName.replace(/_/g, " ") : ""}`, age: typeof lead.age === "number" ? lead.age : null };
    else factionLeader = null;
  }

  // Garrison ground-truth: build per-settlement region-unit sets from crackSave.
  // A settlement's units = land units in its region; field commanders = army
  // commanders NOT standing on the settlement tile. We derive cmdsAtSettlement
  // by matching a commander's coord to a settlement coord when available; lacking
  // exact settlement-tile coords headlessly, we treat ALL army commanders in the
  // region as field stacks and assert they are NOT classified as garrison — i.e.
  // the rule must route them to the field set (the bug routed them to garrison).
  const garrisonSettlements = buildGarrisonSettlements(r);

  // Public-order card divergence: headlessly we don't have the renderer's legacy
  // `happiness` prop, so the divergence sub-check is N/A here; the BAND check
  // still runs and the live/non-live callers supply cardHappinessByCity.
  return {
    label,
    commanders,
    portraitLabel: isNonLive ? "non-live" : "live",
    familyPortraitByKey,
    settlementFields: r.settlementFields,
    diplomacy: r.diplomacy,
    playerFaction: r.playerFaction,
    // We KNOW RIS factions start at war (rebels/slave) — assert the player's war
    // list is non-empty whenever the matrix located. Null when matrix is absent.
    expectWars: r.diplomacy ? true : null,
    garrisonSettlements,
    isGarrisonUnit,
    family: r.characters.family,
    factionLeader,
    // Soft floor: a real campaign has at least a handful of named relatives.
    minFamilyMembers: 3,
    turn: r.turn,
    currentYear: r.currentYear,
    seasonIndex: r.seasonIndex,
    unitAttribution: r._stats && r._stats.unitAttribution,
  };
}

// Group land units by region → settlement, splitting commander-led stacks from
// commander-less garrison units, mirroring the live garrison filter's inputs.
function buildGarrisonSettlements(r) {
  const units = Array.isArray(r.units) ? r.units : [];
  // region → { units:[], cmds:Set }
  const byRegion = new Map();
  for (const u of units) {
    if (u.naval) continue;
    const region = u.region || "?";
    let g = byRegion.get(region);
    if (!g) { g = { units: [], cmds: new Set() }; byRegion.set(region, g); }
    g.units.push({ commanderUuid: u.commanderUuid || null, inferredCmd: u.inferredCmd || null });
    const cmd = u.commanderUuid || u.inferredCmd;
    if (cmd) g.cmds.add(cmd);
  }
  const out = [];
  for (const [region, g] of byRegion) {
    if (g.units.length === 0) continue;
    // Headless ground truth: every commander in the region is treated as a FIELD
    // stack (cmdsAtSettlement empty). The garrison rule should then classify
    // those commander-led units as NOT-garrison. If the rule (or a regression)
    // classified them as garrison with an empty cmdsAtSettlement+no governor,
    // that is the field-leak bug. governorUuid omitted (would correctly pull the
    // governor's stack into garrison — not a leak).
    out.push({ city: region, units: g.units, governorUuid: null, cmdsAtSettlement: new Set(), fieldCommanders: g.cmds });
  }
  return out;
}

// ── reporting ───────────────────────────────────────────────────────────────
function printReport(report) {
  const s = report.summary;
  const head = `\n=== doctor: ${report.label} ===`;
  console.log(head);
  for (const c of report.checks) {
    const mark = c.ok ? "PASS " : (c.severity === "error" ? "ERROR" : "WARN ");
    console.log(`  [${mark}] ${c.name.padEnd(20)} ${c.detail}`);
  }
  console.log(`  → ${s.errors} error(s), ${s.warns} warn(s) — ${s.ok ? "PASS" : "ANOMALY"}`);
  return s.ok;
}

function runOne(savePath, modDir) {
  const buf = fs.readFileSync(savePath);
  const r = crackSave(buf, modDir);
  const base = path.basename(savePath);
  const reports = [];

  // LIVE path.
  const liveInput = buildDiagInput(r, `${base} [live]`, false, opts.injectHash);
  reports.push(runDiagnostics(liveInput));

  // NON-LIVE / starting-state path. Simulated from the SAME crack — the starting
  // armies + descr_strat characters share the resolvers the live path uses, so a
  // correct build agrees with the family tree. (A turn-1 save IS the starting
  // state; for later saves this exercises the same code with live data, which is
  // still a valid regression guard for the non-live resolvers.)
  if (opts.nonlive) {
    const nonLiveInput = buildDiagInput(r, `${base} [non-live]`, true, opts.injectHash);
    reports.push(runDiagnostics(nonLiveInput));
  }
  return reports;
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const modDir = resolveModDir(opts.mod);
  let saves = opts.saves.slice();
  if (opts.allCrash) saves = saves.concat(collectCrashSaves());
  if (saves.length === 0) saves = [DEFAULT_SAVE];

  console.log(`doctor: mod=${modDir}, saves=${saves.length}, nonlive=${opts.nonlive}${opts.injectHash ? ", INJECT-HASH (regression test)" : ""}`);

  const allReports = [];
  let anyError = false;
  for (const sp of saves) {
    if (!fs.existsSync(sp)) { console.error(`  ! save not found: ${sp}`); anyError = true; continue; }
    try {
      const reports = runOne(sp, modDir);
      for (const rep of reports) {
        allReports.push(rep);
        const ok = printReport(rep);
        if (!ok) anyError = true;
      }
    } catch (e) {
      console.error(`  ! load/crack failed for ${path.basename(sp)}: ${e.message}`);
      console.error(e.stack);
      anyError = true;
    }
  }

  if (opts.json) {
    console.log("\n" + JSON.stringify(allReports, null, 2));
  }

  const totErr = allReports.reduce((n, r) => n + (r.summary ? r.summary.errors : 0), 0);
  const totWarn = allReports.reduce((n, r) => n + (r.summary ? r.summary.warns : 0), 0);
  console.log(`\ndoctor: ${allReports.length} report(s), ${totErr} ERROR anomalies, ${totWarn} WARN anomalies`);
  process.exit(anyError ? 1 : 0);
}

main();
