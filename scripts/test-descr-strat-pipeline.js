// test-descr-strat-pipeline.js — quick end-to-end smoke test for the
// save → descr_strat → validate → (optional) deploy pipeline.
//
// Runs against every .sav in derived/ or a user-supplied directory and
// confirms each step works. Prints a final summary table.

"use strict";
const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_SAVES_DIR = "C:/Users/vtarn/Downloads";

function listSaves(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".sav") && !f.startsWith("save_TEST_"))  // skip splice-test saves
    .map(f => path.join(dir, f));
}

function run(label, cmd, args) {
  try {
    const out = execFileSync("node", [cmd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: e.stdout || "", err: e.stderr || e.message };
  }
}

const savesDir = process.argv[2] || DEFAULT_SAVES_DIR;
const saves = listSaves(savesDir);
if (saves.length === 0) {
  console.error("no .sav files found in:", savesDir);
  process.exit(1);
}
console.log(`testing ${saves.length} saves from ${savesDir}\n`);

const results = [];
for (const sav of saves) {
  const base = path.basename(sav, ".sav");
  process.stdout.write(`${base.padEnd(50)} `);
  const gen = run("gen", path.join(SCRIPT_DIR, "save-to-descr-strat.js"), [sav]);
  if (!gen.ok) {
    console.log("✗ GEN FAILED");
    results.push({ save: base, status: "gen-failed", note: gen.err.slice(0, 60) });
    continue;
  }
  const outFile = path.join(PROJECT_ROOT, "derived", base + ".descr_strat.txt");
  if (!fs.existsSync(outFile)) {
    console.log("✗ GEN OK but no output file");
    results.push({ save: base, status: "no-output" });
    continue;
  }
  // Re-use the SAME mod dir the generator auto-detected (printed as
  // 'auto-detected from save: ... → <path>'). Without this, validator
  // would default to bundled-mod and surface false-positive trait/unit
  // warnings when the user's installed mod has a different vocabulary.
  let validatorArgs = [outFile];
  const modMatch = gen.out.match(/auto-detected from save:[^→]*→\s*([^)]+)\)/);
  if (modMatch) {
    const detected = modMatch[1].trim();
    const dataDir = path.join(detected, "data");
    if (fs.existsSync(dataDir)) validatorArgs.push(dataDir);
  }
  const val = run("val", path.join(SCRIPT_DIR, "validate-descr-strat.js"), validatorArgs);
  const valOk = /✓ no structural issues detected|Issues: 0 errors,/.test(val.out);
  const sizeKB = (fs.statSync(outFile).size / 1024).toFixed(0);

  // Pull a few key stats out of the generator's stdout for the summary.
  const stats = {};
  const m1 = gen.out.match(/factions emitted:\s+(\d+)/);          if (m1) stats.factions = +m1[1];
  const m2 = gen.out.match(/settlements:\s+(\d+)/);                if (m2) stats.settlements = +m2[1];
  const m3 = gen.out.match(/living characters:\s+(\d+) emitted/);  if (m3) stats.chars = +m3[1];
  const m4 = gen.out.match(/units in armies:\s+(\d+)/);            if (m4) stats.units = +m4[1];
  const m5 = gen.out.match(/treasuries matched:\s+(\d+)/);         if (m5) stats.treasuries = +m5[1];
  const m6 = gen.out.match(/diplomatic stances:\s+(\d+) wars,\s+(\d+) alliances/);
  if (m6) { stats.wars = +m6[1]; stats.alliances = +m6[2]; }
  console.log(valOk ? "✓" : "✗ VALIDATE FAILED");
  results.push({ save: base, status: valOk ? "ok" : "validate-failed", sizeKB, ...stats });
}

console.log();
console.log("SUMMARY");
console.log("=".repeat(140));
console.log(
  "save".padEnd(48) + " " +
  "status".padEnd(8) + " " +
  "KB".padStart(5) + " " +
  "facts".padStart(5) + " " +
  "setts".padStart(5) + " " +
  "chars".padStart(5) + " " +
  "units".padStart(5) + " " +
  "treas".padStart(5) + " " +
  "wars".padStart(5) + " " +
  "alli".padStart(5)
);
console.log("-".repeat(140));
for (const r of results) {
  console.log(
    r.save.padEnd(48) + " " +
    r.status.padEnd(8) + " " +
    String(r.sizeKB ?? "?").padStart(5) + " " +
    String(r.factions ?? "-").padStart(5) + " " +
    String(r.settlements ?? "-").padStart(5) + " " +
    String(r.chars ?? "-").padStart(5) + " " +
    String(r.units ?? "-").padStart(5) + " " +
    String(r.treasuries ?? "-").padStart(5) + " " +
    String(r.wars ?? "-").padStart(5) + " " +
    String(r.alliances ?? "-").padStart(5)
  );
}
const okCount = results.filter(r => r.status === "ok").length;
console.log("-".repeat(140));
console.log(`${okCount}/${results.length} saves passed full pipeline`);
process.exit(okCount === results.length ? 0 : 1);
