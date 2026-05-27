// deploy-descr-strat.js — copy a generated descr_strat into an RTW
// campaign folder for in-game testing.
//
// Workflow:
//   1. node scripts/save-to-descr-strat.js <save> [out]   → derived/<save>.descr_strat.txt
//   2. node scripts/deploy-descr-strat.js <generated.txt> [target-campaign-dir]
//
// Target-campaign-dir defaults to bundled-mod/data/world/maps/campaign/imperial_campaign.
// To test against the actual installed mod, pass the user's RTW campaign
// folder path explicitly, e.g.:
//   C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/
//     VFS/Local/Mods/My Mods/RIS/data/world/maps/campaign/imperial_campaign
//
// This script:
//   - Backs up the existing descr_strat.txt to descr_strat.txt.backup
//     (only on FIRST run — subsequent runs preserve the original backup)
//   - Copies the generated file in place
//   - Prints clear instructions on how to test + rollback
//
// To rollback:
//   node scripts/deploy-descr-strat.js --rollback [target-campaign-dir]

"use strict";
const fs = require("fs");
const path = require("path");

const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_TARGET = path.join(
  PROJECT_ROOT, "bundled-mod", "data", "world", "maps", "campaign", "imperial_campaign"
);

// Hunt for likely RTW mod imperial_campaign folders. Windows-specific paths
// for now; covers Feral Interactive's standard install layout.
function findCandidateTargets() {
  const out = new Set();
  out.add(DEFAULT_TARGET);
  const modsRoots = [
    "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods",
    "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/Local Mods",
  ];
  function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      // If THIS dir is named imperial_campaign and contains descr_strat.txt, add it
      if (e.name === "imperial_campaign" && fs.existsSync(path.join(sub, "descr_strat.txt"))) {
        out.add(sub);
      }
      walk(sub, depth + 1);
    }
  }
  for (const r of modsRoots) walk(r, 0);
  return [...out];
}

function rollback(targetDir) {
  const target = path.join(targetDir, "descr_strat.txt");
  const backup = path.join(targetDir, "descr_strat.txt.backup");
  if (!fs.existsSync(backup)) {
    console.error("No backup found at:", backup);
    console.error("Nothing to roll back.");
    process.exit(1);
  }
  fs.copyFileSync(backup, target);
  console.log("✓ Restored", target, "from backup.");
  // Don't delete the backup — user might want to re-deploy
}

function deploy(generatedPath, targetDir) {
  if (!fs.existsSync(generatedPath)) {
    console.error("Generated file not found:", generatedPath);
    process.exit(1);
  }
  if (!fs.existsSync(targetDir)) {
    console.error("Target campaign dir not found:", targetDir);
    console.error("Pass the correct campaign dir as 2nd arg.");
    process.exit(1);
  }
  const target = path.join(targetDir, "descr_strat.txt");
  const backup = path.join(targetDir, "descr_strat.txt.backup");

  // Preserve the FIRST original (don't overwrite a backup with a previously
  // deployed file — that would lose the true original).
  if (fs.existsSync(target) && !fs.existsSync(backup)) {
    fs.copyFileSync(target, backup);
    console.log("✓ Backed up original to", backup);
  } else if (!fs.existsSync(backup)) {
    console.log("(no existing descr_strat to back up)");
  } else {
    console.log("(backup already exists, preserving)");
  }

  fs.copyFileSync(generatedPath, target);
  const srcSize = (fs.statSync(generatedPath).size / 1024).toFixed(1);
  console.log(`✓ Copied ${generatedPath} → ${target} (${srcSize} KB)`);
  console.log();
  console.log("=== Next steps ===");
  console.log("1. Launch RTW Remastered.");
  console.log("2. Start a NEW imperial_campaign (NOT load — start fresh).");
  console.log("3. Pick a faction. The map should reflect your save's ownership +");
  console.log("   buildings + characters + treasuries + diplomatic state.");
  console.log("4. If the engine errors on load, check VFS/Local/Rome/logs/error_log.txt");
  console.log("   for specifics (missing units, invalid traits, etc.) — most issues");
  console.log("   stem from references to mod content not present in the bundled");
  console.log("   descr_names_lookup / EDB / EDU.");
  console.log();
  console.log("=== Rollback ===");
  console.log("If anything breaks: node scripts/deploy-descr-strat.js --rollback");
  console.log("Or manually: copy descr_strat.txt.backup over descr_strat.txt");
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log("usage:");
  console.log("  node scripts/deploy-descr-strat.js <generated-file> [target-campaign-dir]");
  console.log("  node scripts/deploy-descr-strat.js --rollback [target-campaign-dir]");
  console.log("  node scripts/deploy-descr-strat.js --list-targets");
  console.log();
  console.log("Default target campaign dir:");
  console.log("  " + DEFAULT_TARGET);
  process.exit(0);
}
if (argv[0] === "--list-targets") {
  console.log("Candidate imperial_campaign folders:");
  for (const t of findCandidateTargets()) console.log("  " + t);
  process.exit(0);
}
if (argv[0] === "--rollback") {
  rollback(argv[1] || DEFAULT_TARGET);
} else {
  deploy(argv[0], argv[1] || DEFAULT_TARGET);
}
