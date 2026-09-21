#!/usr/bin/env node
/**
 * Rebuild the save-parser fixtures.  node scripts/build-save-fixtures.js [--force]
 *
 * WHY THIS EXISTS. Four parser suites (units, ownership, faction records, lua
 * counters) are driven by real .sav files. `.gitignore` excludes `*.sav` on
 * purpose — a save is 35-45 MB and this repo is public — so the fixtures live
 * untracked in scripts/save-fixtures/feral/ and every test skips
 * without them. They had been missing long enough that 25 tests were reporting
 * PASSED while doing nothing (fixed 2026-09-21: they now skip out loud).
 *
 * THE SAVES ARE OLDER THAN THE MOD. They come from whatever RIS build was
 * installed when they were played, so a fixture's contents must never be
 * checked against today's C:/RIS. The manifest below therefore records what
 * each parser ACTUALLY produced on the day a human accepted the fixture; the
 * tests assert against that (a golden file), plus invariants that hold for any
 * save. Drift is small but real and is measured, not assumed: on the turn-1
 * fixture — which by definition has made no conquests — exactly 2 settlements
 * disagree with today's descr_strat start and 7 are absent from it.
 *
 * Re-running is safe: an existing fixture whose sha256 still matches the
 * manifest is left alone. `--force` re-copies. A fixture whose numbers have
 * MOVED is reported and not silently rewritten — that is either a parser
 * change to review or a different save, and the run fails so somebody looks.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DEST = path.join(ROOT, "scripts", "save-fixtures", "feral");
const MANIFEST = path.join(DEST, "manifest.json");
const FORCE = process.argv.includes("--force");

// Where saves are looked for, in order.
const SEARCH = [
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves",
  "C:/dev/log test files",
  path.join(ROOT, "calibration", "saves"),
];

// The fixture set. `source` is a save file's exact name in one of SEARCH.
const FIXTURES = [
  {
    name: "identical_A.sav",
    source: "save_18-06-2026   Bactria   Turn 1 b.sav",
    why: "Turn 1, no conquests: the parser-determinism pair, and the mod-drift baseline.",
  },
  {
    name: "identical_B.sav",
    source: "save_Autosave   Bactria   Turn 1.sav",
    why: "The same game state as identical_A saved a second time — DIFFERENT bytes, identical parse. That is what makes the determinism tests mean something; a byte copy would pass trivially.",
  },
  {
    name: "ror_t5s.sav",
    source: "save_Autosave   Republic of Rome   Turn 5 Start.sav",
    why: "Early turn of a campaign continued in ror_t17s — the two ends of the faction-record growth curve.",
  },
  {
    name: "ror_t17s.sav",
    source: "save_Autosave   Republic of Rome   Turn 17 Start.sav",
    why: "Same campaign, 12 turns later: conquests to recover, long region names, a real navy.",
  },
];

const sha256 = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// Everything the tests pin, derived from the fixture itself.
function derive(file) {
  const buf = fs.readFileSync(file);
  const { findUnitRecords } = require(path.join(ROOT, "src", "unitParser.js"));
  const { findFactionRecords } = require(path.join(ROOT, "src", "factionRecordParser.js"));
  const { findLuaCounters } = require(path.join(ROOT, "src", "luaCounterParser.js"));
  const { parseTurn } = require(path.join(ROOT, "src", "turnParser.js"));

  const units = findUnitRecords(buf);
  const facs = findFactionRecords(buf);
  const offsets = facs.map((r) => r.offset).filter((x) => x != null);
  const navy = units.filter((u) => /^naval\s/.test(u.name));
  const turn = (() => { try { const t = parseTurn(buf); return t && t.turn; } catch { return null; } })();

  return {
    bytes: buf.length,
    turn,
    units: units.length,
    unitRegions: new Set(units.map((u) => u.region)).size,
    longRegions: new Set(units.map((u) => u.region).filter((r) => r && r.length > 25)).size,
    navy: navy.length,
    navyWithSoldiers: navy.filter((u) => u.soldiers > 0).length,
    factionRecords: facs.length,
    luaCounters: findLuaCounters(buf).length,
    factionArraySpan: offsets.length ? Math.max(...offsets) - Math.min(...offsets) : null,
  };
}

function findSource(name) {
  for (const dir of SEARCH) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

fs.mkdirSync(DEST, { recursive: true });
const prev = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { fixtures: {} };
const manifest = { note: "Derived values, recorded when each fixture was accepted. The saves predate the current mod — never check them against C:/RIS.", builtAt: new Date().toISOString().slice(0, 10), fixtures: {} };

let copied = 0, kept = 0, missing = [], moved = [];
for (const fx of FIXTURES) {
  const dest = path.join(DEST, fx.name);
  const was = prev.fixtures[fx.name];

  if (fs.existsSync(dest) && !FORCE && was && was.sha256 === sha256(dest)) {
    manifest.fixtures[fx.name] = was;
    kept++;
    continue;
  }
  const src = findSource(fx.source);
  if (!src) {
    missing.push(`${fx.name}  <-  ${fx.source}`);
    if (was) manifest.fixtures[fx.name] = was; // keep the record so the expectations survive
    continue;
  }
  fs.copyFileSync(src, dest);
  copied++;
  const entry = { source: fx.source, why: fx.why, sha256: sha256(dest), expect: derive(dest) };
  if (was && JSON.stringify(was.expect) !== JSON.stringify(entry.expect)) {
    const diff = Object.keys(entry.expect).filter((k) => JSON.stringify(was.expect[k]) !== JSON.stringify(entry.expect[k]));
    moved.push(`${fx.name}: ${diff.map((k) => `${k} ${JSON.stringify(was.expect[k])} -> ${JSON.stringify(entry.expect[k])}`).join(", ")}`);
  }
  manifest.fixtures[fx.name] = entry;
}

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

console.log(`fixtures: ${copied} copied, ${kept} already current -> ${path.relative(ROOT, DEST)}`);
for (const [name, e] of Object.entries(manifest.fixtures)) {
  console.log(`  ${name.padEnd(16)} turn ${String(e.expect.turn).padStart(3)}  ${String(e.expect.units).padStart(5)} units  ${String(e.expect.factionRecords).padStart(3)} faction records  ${e.expect.luaCounters} lua counters`);
}
if (missing.length) {
  console.log(`\nNOT FOUND (their tests will skip):\n  ${missing.join("\n  ")}`);
  console.log(`searched:\n  ${SEARCH.join("\n  ")}`);
}
if (moved.length) {
  console.error(`\nA fixture's parsed output CHANGED against the manifest:\n  ${moved.join("\n  ")}`);
  console.error("Either a parser changed (review it, then re-run to accept) or the source save is not the one recorded.");
  process.exit(1);
}
