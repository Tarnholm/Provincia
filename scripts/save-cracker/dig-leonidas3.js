// Just look at the byte-diff between Sparta baseline and save_1.3 (Leonidas
// moved 2 tiles). Movement is minimal action — most changes should localize
// in a small region. Find that region.
import fs from "node:fs";
import path from "node:path";
import { diffSmart } from "./diff.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_1.3.sav"));

console.log(`baseline: ${a.length.toLocaleString()}  save_1.3: ${b.length.toLocaleString()}\n`);
console.log(`computing shift-aware diff…`);
const sm = diffSmart(a, b);
const totalChanged = sm.runs.reduce((s, r) => s + Math.max(r.aEnd - r.aStart, r.bEnd - r.bStart), 0);
console.log(`${sm.runs.length} change-runs, ${totalChanged.toLocaleString()} total bytes changed`);

// Sort runs by length, ignoring tiny ones
const longRuns = sm.runs
  .map(r => ({ ...r, lenA: r.aEnd - r.aStart, lenB: r.bEnd - r.bStart }))
  .filter(r => Math.max(r.lenA, r.lenB) >= 4)
  .sort((a, b) => Math.max(b.lenA, b.lenB) - Math.max(a.lenA, a.lenB));
console.log(`\n[top 30 longest runs ≥4B]`);
for (const r of longRuns.slice(0, 30)) {
  const len = Math.max(r.lenA, r.lenB);
  // Sample a few bytes
  const aBytes = Array.from(a.subarray(r.aStart, Math.min(r.aStart + 16, r.aEnd))).map(b => b.toString(16).padStart(2,"0")).join(" ");
  const bBytes = Array.from(b.subarray(r.bStart, Math.min(r.bStart + 16, r.bEnd))).map(b => b.toString(16).padStart(2,"0")).join(" ");
  console.log(`  @0x${r.aStart.toString(16).padStart(8,"0")} (lenA=${r.lenA}, lenB=${r.lenB})`);
  console.log(`    base: ${aBytes}${r.lenA > 16 ? "..." : ""}`);
  console.log(`    var:  ${bBytes}${r.lenB > 16 ? "..." : ""}`);
}

// Also: look at u16/u32 transitions from "small int" values to other "small int"
// values within the long runs. These are likely the actual position fields.
console.log(`\n[short-run u16 transitions where both vals are "map-coord-like" small ints]`);
const candidates = [];
for (const r of longRuns.slice(0, 100)) {
  for (let i = r.aStart; i + 2 <= r.aEnd; i++) {
    if (i + 2 > b.length) break;
    const av = a.readUInt16LE(i);
    // Find a corresponding offset in b within the run (rough alignment)
    const bI = r.bStart + (i - r.aStart);
    if (bI + 2 > b.length) continue;
    const bv = b.readUInt16LE(bI);
    if (av === bv) continue;
    if (av < 50 || av > 4000 || bv < 50 || bv > 4000) continue;
    if (Math.abs(av - bv) > 50) continue;
    // Could be a position field
    candidates.push({ off: i, av, bv, runLenA: r.lenA });
  }
}
console.log(`  ${candidates.length} candidate u16 transitions`);
const dedup = new Map();
for (const c of candidates) {
  const k = c.off;
  if (!dedup.has(k)) dedup.set(k, c);
}
const unique = [...dedup.values()].sort((a, b) => a.off - b.off);
// Filter to those where the value is plausibly Leonidas's coords or close
const interesting = unique.filter(c => {
  // Look for transitions like 398→400, 337→335, or values in those ranges
  const targets = [398, 400, 337, 335, 1049, 1072];
  return targets.some(t => Math.abs(c.av - t) <= 4 || Math.abs(c.bv - t) <= 4);
});
console.log(`  ${interesting.length} match Leonidas-coord-vicinity values`);
for (const c of interesting.slice(0, 30)) {
  console.log(`    @0x${c.off.toString(16).padStart(8,"0")}  ${c.av} → ${c.bv}`);
}
