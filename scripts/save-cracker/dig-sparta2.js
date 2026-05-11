// Targeted search for "sparta" / "argos" / "Prasiai" / known integers in
// the Sparta-baseline save and the war-declaration variant. Skip the oracle
// — just find each string directly and report nearby short-byte changes.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const a = fs.readFileSync(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = fs.readFileSync(path.join(SAVE_DIR, "save_1.1.sav"));

console.log(`baseline: ${a.length.toLocaleString()}  variant: ${b.length.toLocaleString()}  Δ=${b.length - a.length}\n`);

function findAll(buf, needle, max = 100) {
  const hits = []; let from = 0;
  while (hits.length < max) {
    const i = buf.indexOf(needle, from);
    if (i < 0) break;
    hits.push(i); from = i + 1;
  }
  return hits;
}

const probes = ["sparta", "argos", "achaea", "aetolia", "greeks", "Prasiai", "prasiai", "Sparta", "Argos"];
for (const p of probes) {
  const u8 = Buffer.from(p, "utf-8");
  const hA = findAll(a, u8);
  const hB = findAll(b, u8);
  console.log(`"${p}": baseline=${hA.length} variant=${hB.length}`);
  if (hA.length && hA.length < 30) {
    console.log(`  baseline hits: ${hA.slice(0, 8).map(o => "0x" + o.toString(16)).join(", ")}`);
  }
}

// Now look around each "sparta" / "argos" hit in baseline for byte changes
// versus variant, restricted to ±2KB.
console.log(`\n[short byte changes near "sparta" cstring hits, ±2KB]`);
const spartaHits = findAll(a, Buffer.from("sparta", "utf-8"));
console.log(`  ${spartaHits.length} sparta string hits in baseline`);
const seen = new Set();
let totalDiffs = 0;
for (const sh of spartaHits.slice(0, 12)) {
  let countNear = 0;
  for (let d = -2048; d <= 2048; d++) {
    const o = sh + d;
    if (o < 0 || o >= a.length || o >= b.length) continue;
    if (a[o] !== b[o]) countNear++;
  }
  console.log(`    sparta @0x${sh.toString(16)}: ${countNear} byte diffs within ±2KB`);
  totalDiffs += countNear;
}

console.log(`\n[short byte changes near "argos" cstring hits, ±2KB]`);
const argosHits = findAll(a, Buffer.from("argos", "utf-8"));
console.log(`  ${argosHits.length} argos string hits in baseline`);
for (const sh of argosHits.slice(0, 12)) {
  let countNear = 0;
  for (let d = -2048; d <= 2048; d++) {
    const o = sh + d;
    if (o < 0 || o >= a.length || o >= b.length) continue;
    if (a[o] !== b[o]) countNear++;
  }
  console.log(`    argos @0x${sh.toString(16)}: ${countNear} byte diffs within ±2KB`);
}

// Find runs that both touch "sparta" and "argos" — those are likely the
// diplomatic matrix entry between them.
console.log(`\n[byte changes <16B in length] (likely small enum/state changes)`);
let inRun = false, runStart = 0;
const minLen = Math.min(a.length, b.length);
const smallRuns = [];
for (let i = 0; i < minLen; i++) {
  if (a[i] !== b[i]) { if (!inRun) { runStart = i; inRun = true; } }
  else if (inRun) {
    if (i - runStart <= 16) smallRuns.push({ start: runStart, end: i, len: i - runStart });
    inRun = false;
  }
}
console.log(`  ${smallRuns.length} short-byte-runs (<=16B). Showing top 50 sorted by neighborhood ratio…`);

// For each short run, count how many sparta/argos string hits are within 1KB
const spartaSet = new Set(spartaHits);
const argosSet = new Set(argosHits);
function inRange(set, off, win) {
  for (const s of set) if (Math.abs(s - off) <= win) return true;
  return false;
}
const ranked = smallRuns.map(r => ({
  ...r,
  nearSparta: inRange(spartaSet, r.start, 1024),
  nearArgos: inRange(argosSet, r.start, 1024),
}));
const both = ranked.filter(r => r.nearSparta && r.nearArgos);
console.log(`  short runs near BOTH sparta AND argos within ±1KB: ${both.length}`);
for (const r of both.slice(0, 25)) {
  const aBytes = Array.from(a.subarray(r.start, r.start + r.len)).map(x => x.toString(16).padStart(2, "0")).join(" ");
  const bBytes = Array.from(b.subarray(r.start, r.start + r.len)).map(x => x.toString(16).padStart(2, "0")).join(" ");
  // find nearest sparta/argos string offsets
  let minSparta = Infinity, minArgos = Infinity;
  for (const s of spartaHits) minSparta = Math.min(minSparta, Math.abs(s - r.start) <= 1024 ? s - r.start : Infinity);
  for (const s of argosHits) minArgos = Math.min(minArgos, Math.abs(s - r.start) <= 1024 ? s - r.start : Infinity);
  console.log(`  @0x${r.start.toString(16).padStart(8,"0")} ${r.len}B  ${aBytes} → ${bBytes}  Δsparta=${minSparta} Δargos=${minArgos}`);
}
