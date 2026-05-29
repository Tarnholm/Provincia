#!/usr/bin/env node
// edct-bisector.js — narrow down a EDCT trait or trigger that's causing
// `min <= max Failed` in RTW.
//
// HOW IT WORKS
// ============
// RTW's `min <= max Failed` errors fire when the engine calls
// `random(N, M)` with N >= M. With ~3,800 traits and ~7,400 trigger
// blocks in a typical RIS EDCT, finding the offender manually is
// infeasible. Bisection: comment out HALF the trait blocks (or trigger
// blocks), launch RTW + play 1-2 turns, see if the per-turn error count
// drops materially. If yes, the offender is in the commented half;
// flip and bisect again. If no, the offender is in the kept half.
//
// USAGE
// =====
//   node scripts/edct-bisector.js init <path-to-EDCT> [--target Affects:TraitName]
//       Sets up bisect state (creates .bisect/ dir, backs up EDCT).
//       --target Affects:TurnsAlive   bisects only Trigger blocks that
//                                     contain "Affects TurnsAlive" lines.
//       --target Trait:TraitName      bisects only matching Trait blocks.
//       Default (no --target): bisects every Trait + Trigger block.
//   node scripts/edct-bisector.js step <left|right>
//       Records that the LEFT or RIGHT half kept errors firing, then
//       generates the next variant (commenting out half of the suspect
//       portion).
//   node scripts/edct-bisector.js status
//       Show current narrow window + how many trait blocks are in it.
//   node scripts/edct-bisector.js restore
//       Restore original EDCT from backup.
//
// TYPICAL TARGETED RUN
// ====================
// From earlier analysis: 65 % of min<=max errors fire after TurnsAlive
// grants. Bisecting only triggers that Affect TurnsAlive narrows ~14k
// triggers to ~20, converging in 4-5 RTW restarts instead of 15.
//   node scripts/edct-bisector.js init <EDCT-path> --target Affects:TurnsAlive
//
// TYPICAL FLOW
// ============
//   1. node scripts/edct-bisector.js init <EDCT-path>
//      → produces EDCT with second-half of TRAITS commented out
//   2. Quit RTW, relaunch, fresh campaign, end turn 1-2
//   3. Run `grep -c "min <= max" <message_log.txt>` — note delta vs baseline
//      (we recorded baseline 218/turn before bisection started)
//   4. If delta dropped to 0 → offender is in COMMENTED half → step left
//      If delta still high → offender is in KEPT half → step right
//   5. Repeat 2-4 until narrowed to 1-2 traits
//
// CAVEATS
// =======
// - The engine may CRASH or fail to load if specific traits are
//   commented out (e.g. TurnsAlive is referenced by descr_character).
//   In that case the bisector pads with a stub. NOT YET IMPLEMENTED —
//   the v1 here only comments out blocks WITHOUT padding.
// - Bisection assumes ONE offender. If multiple traits trigger
//   min<=max, you'll narrow to the most-frequent one first; rerun
//   afterwards to find the next.

"use strict";
const fs = require("fs");
const path = require("path");

const STATE_DIR = ".bisect";
const STATE_FILE = "state.json";

function usage() {
  console.error("usage:");
  console.error("  node scripts/edct-bisector.js init <EDCT-path>");
  console.error("  node scripts/edct-bisector.js step <left|right>");
  console.error("  node scripts/edct-bisector.js status");
  console.error("  node scripts/edct-bisector.js restore");
  process.exit(2);
}

function parseTraitBlocks(text, targetFilter) {
  // Returns { blocks, lines } where blocks = [{ type, name, start, end }],
  // start/end are 0-indexed line numbers (inclusive). A block spans `Trait
  // <Name>` or `Trigger <Name>` through the line before the next block
  // header (or EOF).
  //
  // targetFilter (optional):
  //   { kind: "Affects", trait: "TurnsAlive" } — keeps only Trigger blocks
  //       that contain an `Affects TurnsAlive` line.
  //   { kind: "Trait",   trait: "TurnsAlive" } — keeps only the matching
  //       Trait block.
  //   null/undefined → all blocks.
  const lines = text.split(/\r?\n/);
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const tm = lines[i].match(/^Trait\s+(\w+)/);
    if (tm) headers.push({ type: "Trait", name: tm[1], line: i });
    const trm = lines[i].match(/^Trigger\s+(\w+)/);
    if (trm) headers.push({ type: "Trigger", name: trm[1], line: i });
  }
  headers.push({ line: lines.length });
  let blocks = [];
  for (let h = 0; h < headers.length - 1; h++) {
    if (!headers[h].type) continue;
    blocks.push({
      type: headers[h].type,
      name: headers[h].name,
      start: headers[h].line,
      end: headers[h + 1].line - 1,
    });
  }
  if (targetFilter) {
    if (targetFilter.kind === "Trait") {
      blocks = blocks.filter(b => b.type === "Trait" && b.name === targetFilter.trait);
    } else if (targetFilter.kind === "Affects") {
      const re = new RegExp(`^\\s*Affects\\s+${targetFilter.trait}\\b`, "i");
      blocks = blocks.filter(b => {
        if (b.type !== "Trigger") return false;
        for (let i = b.start; i <= b.end; i++) {
          if (re.test(lines[i])) return true;
        }
        return false;
      });
    }
  }
  return { blocks, lines };
}

function loadState(edctDir) {
  const p = path.join(edctDir, STATE_DIR, STATE_FILE);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveState(edctDir, state) {
  const dir = path.join(edctDir, STATE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2), "utf8");
}

function applyComments(text, blocksToComment) {
  const { blocks, lines } = parseTraitBlocks(text);
  const commentSet = new Set(blocksToComment.map(b => `${b.type}/${b.name}`));
  const out = [];
  let blockIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    while (blockIdx < blocks.length && blocks[blockIdx].end < i) blockIdx++;
    const b = blocks[blockIdx];
    if (b && i >= b.start && i <= b.end && commentSet.has(`${b.type}/${b.name}`)) {
      const ln = lines[i];
      // Prefix with ;BISECT — keeps the block parseable if uncommented manually
      out.push(ln.startsWith(";") ? ln : ";BISECT " + ln);
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\r\n");
}

function parseTargetArg(args) {
  const idx = args.indexOf("--target");
  if (idx < 0) return null;
  const val = args[idx + 1];
  if (!val) { console.error("--target requires Affects:TraitName or Trait:TraitName"); process.exit(2); }
  const [kind, trait] = val.split(":");
  if (!["Affects", "Trait"].includes(kind) || !trait) { console.error(`bad --target value: ${val}`); process.exit(2); }
  return { kind, trait };
}

function cmdInit(edctPath, extraArgs) {
  if (!fs.existsSync(edctPath)) { console.error("EDCT not found:", edctPath); process.exit(1); }
  const target = parseTargetArg(extraArgs || []);
  const edctDir = path.dirname(edctPath);
  const backupDir = path.join(edctDir, STATE_DIR);
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "original.txt");
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(edctPath, backupPath);
    console.log(`backup → ${backupPath}`);
  } else {
    console.log(`backup already exists at ${backupPath}`);
  }
  const text = fs.readFileSync(edctPath, "utf8");
  const { blocks } = parseTraitBlocks(text, target);
  if (target) console.log(`target: ${target.kind}:${target.trait}`);
  console.log(`bisection scope: ${blocks.length} blocks (${blocks.filter(b => b.type === "Trait").length} traits, ${blocks.filter(b => b.type === "Trigger").length} triggers)`);
  if (blocks.length === 0) { console.error("nothing to bisect — adjust --target"); process.exit(1); }
  if (blocks.length === 1) {
    console.log(`only one block matches — that's your candidate: ${blocks[0].type} ${blocks[0].name}`);
    process.exit(0);
  }
  console.log(`expected RTW-restart iterations: ~${Math.ceil(Math.log2(blocks.length))}`);
  const state = {
    edctPath,
    backupPath,
    target,
    windowStart: 0,
    windowEnd: blocks.length - 1,
    history: [],
    iteration: 0,
  };
  cutAndWrite(state, text, blocks);
  saveState(edctDir, state);
}

function cutAndWrite(state, text, blocks) {
  // Comment out the upper half of [windowStart, windowEnd].
  const lo = state.windowStart, hi = state.windowEnd;
  const mid = Math.floor((lo + hi) / 2);
  const commentBlocks = blocks.slice(mid + 1, hi + 1);
  console.log(`iteration ${state.iteration}: window [${lo}..${hi}] (${hi - lo + 1} blocks)`);
  console.log(`  commenting blocks [${mid + 1}..${hi}] (${commentBlocks.length} blocks)`);
  console.log(`  sample commented: ${commentBlocks.slice(0, 3).map(b => b.type + " " + b.name).join(", ")}${commentBlocks.length > 3 ? ", …" : ""}`);
  const newText = applyComments(text, commentBlocks);
  fs.writeFileSync(state.edctPath, newText, "utf8");
  state.lastCut = { mid, commented: { lo: mid + 1, hi } };
}

function cmdStep(side) {
  if (side !== "left" && side !== "right") usage();
  // Find EDCT path from state in cwd or parent (the file the user inits with)
  const edctDir = findStateDir();
  if (!edctDir) { console.error("no .bisect state found; run init first"); process.exit(1); }
  const state = loadState(edctDir);
  if (!state) { console.error("state file missing"); process.exit(1); }
  // Reload from original each step so we apply a fresh cut.
  const orig = fs.readFileSync(state.backupPath, "utf8");
  const { blocks } = parseTraitBlocks(orig, state.target);
  const lo = state.windowStart, hi = state.windowEnd;
  const mid = Math.floor((lo + hi) / 2);
  state.history.push({ iteration: state.iteration, lo, hi, mid, side });
  if (side === "left") {
    // Errors still in the kept (LEFT) half → narrow to [lo..mid]
    state.windowEnd = mid;
  } else {
    // Errors in the commented (RIGHT) half → narrow to [mid+1..hi]
    state.windowStart = mid + 1;
  }
  state.iteration++;
  if (state.windowStart === state.windowEnd) {
    const culprit = blocks[state.windowStart];
    console.log(`\n🎯 Bisection complete. Likely offender:`);
    console.log(`   ${culprit.type} ${culprit.name} (block ${state.windowStart}, lines ${culprit.start + 1}-${culprit.end + 1})`);
    console.log(`\nRestore EDCT with: node scripts/edct-bisector.js restore`);
    fs.copyFileSync(state.backupPath, state.edctPath);
    saveState(edctDir, state);
    return;
  }
  cutAndWrite(state, orig, blocks);
  saveState(edctDir, state);
}

function cmdStatus() {
  const edctDir = findStateDir();
  if (!edctDir) { console.error("no .bisect state found"); process.exit(1); }
  const state = loadState(edctDir);
  const orig = fs.readFileSync(state.backupPath, "utf8");
  const { blocks } = parseTraitBlocks(orig, state.target);
  const lo = state.windowStart, hi = state.windowEnd;
  if (state.target) console.log(`target: ${state.target.kind}:${state.target.trait}`);
  console.log(`iteration ${state.iteration}`);
  console.log(`window: [${lo}..${hi}] (${hi - lo + 1} blocks)`);
  console.log(`history:`);
  for (const h of state.history) console.log(`  it=${h.iteration} window=[${h.lo}..${h.hi}] mid=${h.mid} chose=${h.side}`);
  console.log(`current EDCT: ${state.edctPath}`);
  console.log(`backup: ${state.backupPath}`);
  console.log(`blocks in window (first 10): ${blocks.slice(lo, lo + 10).map(b => b.type + " " + b.name).join(", ")}`);
}

function cmdRestore() {
  const edctDir = findStateDir();
  if (!edctDir) { console.error("no .bisect state found"); process.exit(1); }
  const state = loadState(edctDir);
  fs.copyFileSync(state.backupPath, state.edctPath);
  console.log("restored EDCT from backup");
}

function findStateDir() {
  // Look upward for .bisect/state.json
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, STATE_DIR, STATE_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const cmd = process.argv[2];
if (cmd === "init") cmdInit(process.argv[3], process.argv.slice(4));
else if (cmd === "step") cmdStep(process.argv[3]);
else if (cmd === "status") cmdStatus();
else if (cmd === "restore") cmdRestore();
else usage();
