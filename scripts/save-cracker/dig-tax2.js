// Use the batch.json's pair-3-exclusive signal runs (already shift-aware
// filtered) to find Sakon Taphai's tax field.
//
// For each signal run, dump bytes from baseline + save_3 (and the other
// variants) around the run start. Look for: a single byte (or u16/u32) that
// transitions ENUM-like from one small int to another, ONLY in save_3.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const baseline = fs.readFileSync(path.join(SAVE_DIR, "save_1turnstart.sav"));
const v3 = fs.readFileSync(path.join(SAVE_DIR, "save_3.sav"));
const variants = ["save_1turnchange.sav", "save_2.sav", "save_4.sav", "save_5.sav", "save_6.sav", "save_7.sav"];
const others = variants.map(f => fs.readFileSync(path.join(SAVE_DIR, f)));

const batch = JSON.parse(fs.readFileSync("C:/dev/Provincia/scripts/save-cracker/out/batch.json", "utf-8"));
const pair3 = batch.perPairSignal.find(p => p.pair === 3);
console.log(`pair 3 has ${pair3.signalRuns.length} signal runs`);
console.log(`top 10 runs by length:`);
for (const r of pair3.signalRuns.slice(0, 10)) {
  console.log(`  @0x${r.start.toString(16).padStart(8,"0")}  ${r.len.toString().padStart(5)}B   ${r.near?.label ? `near: ${r.near.label} (+${r.near.delta}B)` : ""}`);
}

// For each signal run, look at bytes IN both baseline and v3 to find enum-like transitions
console.log(`\n=== Inspecting bytes in each signal run ===`);
const enumCandidates = [];
for (const r of pair3.signalRuns.slice(0, 30)) {
  const start = r.start;
  const end = Math.min(start + r.len, baseline.length, v3.length);
  // For every byte in the run, find baseline value vs save_3 value
  // We expect tax = 1→2 or 0→2 or some small enum change
  for (let i = start; i < end; i++) {
    const a = baseline[i];
    const b = v3[i];
    if (a === b) continue;
    if (a >= 16 || b >= 16) continue; // small enum-like
    // Only emit when the change is plausibly enum-like and rare
    const change = `${a}→${b}`;
    enumCandidates.push({ off: i, a, b, runStart: start, runLen: r.len, near: r.near });
  }
}
console.log(`enum-like byte changes (both <16): ${enumCandidates.length}`);

// Group by transition pattern
const byTransition = {};
for (const c of enumCandidates) {
  const k = `${c.a}→${c.b}`;
  if (!byTransition[k]) byTransition[k] = [];
  byTransition[k].push(c);
}
console.log(`\ntransitions seen:`);
for (const [k, arr] of Object.entries(byTransition).sort((a, b) => a[1].length - b[1].length)) {
  console.log(`  ${k}: ${arr.length} occurrences`);
}

// Most-likely tax transition: 1→2 (normal→high) or 0→2 (low→high) or 1→3 (normal→very_high)
const targets = ["1→2", "0→2", "1→3", "2→3", "0→1", "0→3", "0→4", "0→5"];
for (const t of targets) {
  if (!byTransition[t]) continue;
  console.log(`\n=== ${t} candidates: ${byTransition[t].length} ===`);
  // For each, check: does this byte STAY at original value (a) in ALL other variants?
  const verified = [];
  for (const c of byTransition[t]) {
    let stableElsewhere = true;
    for (const ob of others) {
      if (c.off >= ob.length) { stableElsewhere = false; break; }
      if (ob[c.off] !== c.a) { stableElsewhere = false; break; }
    }
    if (stableElsewhere) verified.push(c);
  }
  console.log(`  ${verified.length} are stable in ALL other variants`);
  for (const c of verified.slice(0, 20)) {
    // Dump 16B context
    const ctx = Array.from(baseline.subarray(Math.max(0, c.off - 8), Math.min(baseline.length, c.off + 16)))
      .map(b => b.toString(16).padStart(2, "0")).join(" ");
    const ctx3 = Array.from(v3.subarray(Math.max(0, c.off - 8), Math.min(v3.length, c.off + 16)))
      .map(b => b.toString(16).padStart(2, "0")).join(" ");
    console.log(`    @0x${c.off.toString(16).padStart(8,"0")}  base ${ctx}`);
    console.log(`                       save_3 ${ctx3}  ${c.near?.label ? `(near ${c.near.label})` : ""}`);
  }
}
