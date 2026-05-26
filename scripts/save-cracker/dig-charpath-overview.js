// dig-charpath-overview.js
// GOAL: Locate the character_paths / movement-orders section by diffing a
// static turn-1 Spain save against two saves taken mid-move (spy moved; diplomat
// + army moved). Report (a) section type registry names that look path-related,
// (b) smart-diff changed runs with size deltas, (c) where the appended bytes
// (size delta) land. Research/diagnostics only — no app code touched.
import fs from "node:fs";
import path from "node:path";
import { diffSmart, summarizeSmartDiff, diffByteRuns } from "./diff.js";
import { hex, ascii } from "./loader.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const F_STATIC = "save_17-05-2026   Spain   Turn 1.sav";
const F_SPY    = "save_17-05-2026   Spain   Turn 1 move spy.sav";
const F_DIPARMY= "save_17-05-2026   Spain   Turn 1move diplomat and army.sav";

const stat = fs.readFileSync(path.join(SAVE_DIR, F_STATIC));
const spy  = fs.readFileSync(path.join(SAVE_DIR, F_SPY));
const dip  = fs.readFileSync(path.join(SAVE_DIR, F_DIPARMY));

console.log("=== file sizes ===");
console.log(`static : ${stat.length.toLocaleString()} bytes`);
console.log(`spy    : ${spy.length.toLocaleString()} bytes  (Δ ${spy.length - stat.length})`);
console.log(`diparmy: ${dip.length.toLocaleString()} bytes  (Δ ${dip.length - stat.length})`);

// --- 1. Section type registry near 0x566 (per reference_save_section_type_registry) ---
// Scan for ASCIIZ names containing PATH / MOVE / ORDER / WAYPOINT etc anywhere
console.log("\n=== section/registry names containing PATH|MOVE|ORDER|WAY|MARCH|DEST|GOTO ===");
function scanNames(buf, label) {
  const re = /(PATH|MOVE|ORDER|WAY|MARCH|DEST|GOTO|TARGET|ROUTE|JOURNEY)/;
  const found = [];
  let i = 0;
  while (i < buf.length - 4) {
    if (!((buf[i] >= 0x41 && buf[i] <= 0x5a) || buf[i] === 0x5f)) { i++; continue; }
    let j = i;
    while (j < buf.length && ((buf[j] >= 0x41 && buf[j] <= 0x5a) || (buf[j] >= 0x30 && buf[j] <= 0x39) || buf[j] === 0x5f)) j++;
    const name = buf.subarray(i, j).toString("ascii");
    if (name.length >= 4 && name.length <= 48 && re.test(name)) found.push({ off: i, name });
    i = j + 1;
  }
  // dedupe by name
  const seen = new Map();
  for (const f of found) if (!seen.has(f.name)) seen.set(f.name, f.off);
  console.log(`  [${label}]`);
  for (const [name, off] of seen) console.log(`    0x${off.toString(16).padStart(6,"0")}  ${name}`);
  if (seen.size === 0) console.log("    (none)");
}
scanNames(stat, "static");

// --- 2. smart diff static vs each move ---
function reportDiff(a, b, label) {
  console.log(`\n=== smart diff: static vs ${label} ===`);
  const smart = diffSmart(a, b);
  const sum = summarizeSmartDiff(smart, a, b);
  console.log(`  runs=${sum.runCount} anchored=${sum.pctAnchored} changedA=${sum.pctChangedA} sizeDelta=${sum.sizeDelta}`);
  // Show the meaningful runs (skip tiny / FoW noise where possible). Sort by size.
  const runs = smart.runs
    .map(r => ({ ...r, aLen: r.aEnd - r.aStart, bLen: r.bEnd - r.bStart }))
    .filter(r => r.aLen > 0 || r.bLen > 0);
  // The biggest insert runs are most interesting (appended path records)
  const byInsert = [...runs].sort((x, y) => (y.bLen - y.aLen) - (x.bLen - x.aLen));
  console.log(`  --- top 15 runs by net insertion (bLen-aLen) ---`);
  for (const r of byInsert.slice(0, 15)) {
    const net = r.bLen - r.aLen;
    console.log(`    A[0x${r.aStart.toString(16)}..0x${r.aEnd.toString(16)}] (${r.aLen}b) -> B[0x${r.bStart.toString(16)}..0x${r.bEnd.toString(16)}] (${r.bLen}b)  net=${net>=0?"+":""}${net}`);
  }
  console.log(`  --- total runs: ${runs.length} ---`);
  return { smart, runs };
}
reportDiff(stat, spy, "SPY moved");
reportDiff(stat, dip, "DIPLOMAT+ARMY moved");

// --- 3. show the appended tail (size delta lands at end?) ---
console.log("\n=== tail comparison (last 64 bytes of each) ===");
for (const [label, buf] of [["static", stat], ["spy", spy], ["dip", dip]]) {
  const o = buf.length - 64;
  console.log(`  ${label} @0x${o.toString(16)}: ${hex(buf, o, 64)}`);
}
