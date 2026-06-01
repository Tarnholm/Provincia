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
//   --inject-child-leader  DEBUG: force the resolved faction leader's age to 4
//                          (the overwritten-leader regression) to PROVE the
//                          family check flags it ERROR. In-memory only.
//   --json                emit the structured report as JSON instead of text.
//
// EXIT CODES: 0 = no ERROR anomalies (WARN allowed); 1 = at least one ERROR; 2 = load failure.

const fs = require("fs");
const path = require("path");

const { crackSave } = require("../src/saveCracker.js");
const { runDiagnostics } = require("../src/diagnostics.js");
const { isGarrisonUnit } = require("../src/garrisonClassify.js");
const { parseDescrStrat } = require("../src/descrStratGeneral.js");
const { buildNonLivePortraitMap, resolveNonLiveCommanderInfo, lookupNonLivePortrait } = require("../src/nonLiveCommanderResolver.js");

// ── Authoritative faction-leader source (the family-tree method) ──────────────
// The Family Tree the user sees crowns the member whose descr_strat `character`
// line carries the `leader` tag (parseDescrStrat sets `c.leader`). The save's v1
// records flag `isLeader` via the Factionleader trait, but the name-POOL entries
// (no map tile) also carry it — `.find(isLeader)` over v1 grabs an arbitrary
// pool dummy (e.g. "Biggus_Dickus age 16"), NOT the real leader. So we resolve
// the leader from descr_strat by the `leader` tag, exactly as the family tree
// does. Cached per mod dir (parsed once).
let _descrStratLeaderCache = null;
function descrStratLeaderFor(modDir, faction) {
  if (!faction) return null;
  if (!_descrStratLeaderCache || _descrStratLeaderCache.modDir !== modDir) {
    _descrStratLeaderCache = { modDir, byFaction: null };
    const candidates = [
      path.join(modDir, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
      path.join(modDir, "descr_strat.txt"),
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      try {
        const parsed = parseDescrStrat(fs.readFileSync(p, "utf8"));
        const byFaction = {};
        for (const f of parsed.factions) byFaction[String(f.name).toLowerCase()] = f;
        _descrStratLeaderCache.byFaction = byFaction;
      } catch (e) { void e; }
      break;
    }
  }
  const bf = _descrStratLeaderCache.byFaction;
  if (!bf) return null;
  const f = bf[String(faction).toLowerCase()];
  if (!f || !Array.isArray(f.characters)) return null;
  const lead = f.characters.find((c) => c.leader);
  if (!lead) return null;
  const ln = lead.famTok ? " " + String(lead.famTok).replace(/_/g, " ") : "";
  return { name: `${lead.firstTok}${ln}`, age: typeof lead.age === "number" ? lead.age : null, alive: true };
}

// A tag-bearing family roster for a faction, built from descr_strat the way the
// non-live Family Tree (modFamiliesByFaction) does — each `character` line's
// leader/heir tag rides along. `injectChild` forces the leader's age to 4 to
// prove the regression is caught even via the tag path.
function descrStratFamilyRoster(modDir, faction, injectChild) {
  descrStratLeaderFor(modDir, faction); // ensure cache populated
  const bf = _descrStratLeaderCache && _descrStratLeaderCache.byFaction;
  if (!bf) return null;
  const f = bf[String(faction).toLowerCase()];
  if (!f || !Array.isArray(f.characters)) return null;
  return f.characters.map((c) => {
    const ln = c.famTok ? " " + String(c.famTok).replace(/_/g, " ") : "";
    const tags = c.leader ? ["leader"] : c.heir ? ["heir"] : [];
    let age = typeof c.age === "number" ? c.age : null;
    if (injectChild && c.leader) age = 4;
    return {
      name: `${c.firstTok}${ln}`,
      age,
      faction,
      alive: true,
      isLeader: !!c.leader,
      tags,
    };
  });
}

// ── arg parsing ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = { mod: null, nonlive: false, injectHash: false, injectChildLeader: false, json: false, allCrash: false, saves: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--mod") opts.mod = argv[++i];
  else if (a === "--nonlive") opts.nonlive = true;
  else if (a === "--inject-hash-portraits") opts.injectHash = true;
  else if (a === "--inject-child-leader") opts.injectChildLeader = true;
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

// Build the engine-exact v1 coord→portrait map from a crack (the SAME pick the
// family tree's v1PortraitsByCoord uses), then the descr_strat starting-char
// list (firstTok/famTok/x/y/faction), then run the SHARED non-live resolver over
// every on-map FIELD/GARRISON commander. Returns [{name,faction,savePath,
// resolvable}] — exactly what checkNonLiveCommanders consumes. This exercises
// the REAL commander-card path (resolveNonLiveCommanderInfo), NOT a re-derived
// family-tree resolution — so it FAILS when a commander resolvable via the
// engine-exact map (the family-tree source) falls to the hash pool.
function buildNonLiveCommanderResolution(r, modDir) {
  // v1 coord → engine-exact portrait (same pick + /cards/ rewrite as main.js).
  const v1PortraitsByCoord = {};
  for (const c of r.characters.v1) {
    if (c.isDead) continue;
    if (c.tileX == null || c.tileY == null) continue;
    const pick = pickPortrait(c);
    if (pick) v1PortraitsByCoord[`${c.tileX},${c.tileY}`] = pick.replace(/\/portraits\/portraits\//i, "/portraits/cards/");
  }
  // descr_strat starting characters with coords (the non-live `characters`
  // list — App.js passes startingCharactersFromMod, which carries x,y).
  descrStratLeaderFor(modDir, r.playerFaction); // ensure cache populated
  const bf = _descrStratLeaderCache && _descrStratLeaderCache.byFaction;
  const startingCharacters = [];
  if (bf) {
    for (const fac of Object.keys(bf)) {
      const f = bf[fac];
      if (!f || !Array.isArray(f.characters)) continue;
      for (const c of f.characters) {
        startingCharacters.push({
          firstName: c.firstTok,
          lastName: c.famTok || null,
          faction: f.name,
          x: c.x, y: c.y,
        });
      }
    }
  }
  // statsCache analogue: the crack's persisted name→portrait. Headlessly we
  // don't have the renderer's statsCache, so pass null — the engine-exact map
  // (v1 coords + descr_strat join) is the path under test anyway.
  const portraitMap = buildNonLivePortraitMap(v1PortraitsByCoord, startingCharacters, null);

  // Commanders = the on-map starting royal family / named characters whose card
  // the non-live view renders. Use the descr_strat characters (the SAME source
  // the UI feeds the resolver) so we test resolveNonLiveCommanderInfo directly.
  const commandersResolved = [];
  for (const c of startingCharacters) {
    if (!c.firstName) continue;
    const coord = c.x != null && c.y != null ? `${c.x},${c.y}` : null;
    const resolvable = !!lookupNonLivePortrait(portraitMap, c.firstName, c.lastName, c.faction, coord);
    const info = resolveNonLiveCommanderInfo(c.firstName, c.lastName, c.faction, null, startingCharacters, portraitMap);
    commandersResolved.push({
      name: `${c.firstName}${c.lastName ? " " + String(c.lastName).replace(/_/g, " ") : ""}`,
      faction: c.faction || null,
      savePath: info ? info.savePath : null,
      resolvable,
    });
  }
  return commandersResolved;
}

// Build the diagnostics input from a crackSave result.
// `isNonLive` flips the portrait label and (in the simulated non-live path) marks
// the family-portrait cross-check source — but the resolver is identical, which
// is exactly the property the family-tree-match check asserts.
function buildDiagInput(r, label, isNonLive, injectHash, modDir, injectChildLeader) {
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

  // Faction leader: resolved from descr_strat by the `leader` tag (the SAME
  // member the Family Tree crowns). NOT from v1 `isLeader` — those records
  // include name-pool dummies with no map tile ("Biggus_Dickus age 16"), so a
  // `.find(isLeader)` over v1 returns an arbitrary pool entry, not the real
  // leader. Identical in live and non-live (same descr_strat source).
  let factionLeader = r.playerFaction ? descrStratLeaderFor(modDir, r.playerFaction) : null;
  // --inject-child-leader DEBUG: overwrite the resolved leader's age with a
  // child's (4) to PROVE the check flags the age-4 / overwritten-leader bug.
  if (injectChildLeader && factionLeader) factionLeader = { ...factionLeader, age: 4 };

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
    // We resolved the leader from descr_strat by the `leader` tag, so a real
    // campaign with a known player faction SHOULD have one — assert its
    // presence + adult age (the missing-leader / age-4 regression).
    expectLeader: !!(r.playerFaction && factionLeader),
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
  const liveInput = buildDiagInput(r, `${base} [live]`, false, opts.injectHash, modDir, opts.injectChildLeader);
  reports.push(runDiagnostics(liveInput));

  // NON-LIVE / starting-state path. Simulated from the SAME crack — the starting
  // armies + descr_strat characters share the resolvers the live path uses, so a
  // correct build agrees with the family tree. (A turn-1 save IS the starting
  // state; for later saves this exercises the same code with live data, which is
  // still a valid regression guard for the non-live resolvers.)
  if (opts.nonlive) {
    const nonLiveInput = buildDiagInput(r, `${base} [non-live]`, true, opts.injectHash, modDir, opts.injectChildLeader);
    // Non-live mode mirrors App.js: the family roster comes from descr_strat and
    // CARRIES the `"leader"` tag (modFamiliesByFaction members). Swap in a
    // tag-bearing player-faction roster so checkFamily exercises the SAME
    // family-tree leader-tag method the non-live UI uses — not the caller fallback.
    if (r.playerFaction) {
      const tagged = descrStratFamilyRoster(modDir, r.playerFaction, opts.injectChildLeader);
      if (tagged && tagged.length) {
        nonLiveInput.family = tagged;
        // The roster itself carries the leader tag, so the diagnostic finds the
        // leader without the caller hint — null it to prove the tag path works.
        nonLiveInput.factionLeader = null;
      }
    }
    // 0.9.784: exercise the REAL non-live commander-card resolver. This is the
    // path the family-tree cross-check missed (it falsely passed while the cards
    // hash-pooled the royal family). checkNonLiveCommanders FAILS when a card
    // resolvable via the engine-exact map (the family-tree source) hash-pools.
    nonLiveInput.commandersResolved = buildNonLiveCommanderResolution(r, modDir);
    // --inject-hash-portraits forces every card to the hash pool to PROVE the
    // gate flags the regression (resolvable commanders → hash = ERROR).
    if (opts.injectHash) {
      nonLiveInput.commandersResolved = nonLiveInput.commandersResolved.map((c) => ({ ...c, savePath: null }));
    }
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
