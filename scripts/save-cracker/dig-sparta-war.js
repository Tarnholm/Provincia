// Diff savestartsparta vs save_1.1 (Sparta declares war on Argos + sieges Prasiai)
// Goal: find the DIPLOMATIC_ATTITUDE matrix entry where Sparta×Argos changes
// from "neutral" or "peace" to "war".
//
// Strategy:
//   1. byte-diff the two saves (with shift-aware resync)
//   2. show top change clusters annotated with nearest known oracle string
//   3. cross-correlate: for each changed offset, check if the byte/u16/u32
//      transitions look like a small enum change (e.g., 0→1, 1→3, 2→5),
//      which is the typical diplomatic-state signature
//   4. Look near the strings "sparta" and any of the Greek factions Argos
//      belongs to (Argos is rebel? or part of greek_cities? need to check)
import fs from "node:fs";
import path from "node:path";
import { loadSave } from "./loader.js";
import { buildOracle } from "./oracle.js";
import { diffSmart } from "./diff.js";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");

const a = loadSave(path.join(SAVE_DIR, "save_savestartsparta.sav"));
const b = loadSave(path.join(SAVE_DIR, "save_1.1.sav"));
console.log(`baseline: ${a.size.toLocaleString()} bytes`);
console.log(`variant:  ${b.size.toLocaleString()} bytes  (Δ=${b.size - a.size})`);

// What faction is Argos? Check descr_strat
const stratText = fs.readFileSync("C:/RIS/_submods/RIS_Classic/data/world/maps/campaign/ris_classic/descr_strat.txt", "utf-8");
const argosFaction = (() => {
  // Find which faction owns Argos (a settlement or region)
  let curFac = null;
  let inSettlementBlock = false;
  for (const raw of stratText.split(/\r?\n/)) {
    const fm = raw.match(/^faction\s+(\w+)/);
    if (fm) { curFac = fm[1]; inSettlementBlock = false; continue; }
    if (/^settlement\s*$/.test(raw.trim())) { inSettlementBlock = true; continue; }
    if (inSettlementBlock) {
      const m = raw.match(/^\s*region\s+(\S+)/);
      if (m && m[1].toLowerCase().includes("argos")) return curFac;
    }
  }
  return null;
})();
console.log(`Argos owner faction in descr_strat: ${argosFaction || "?"}`);

console.log(`\n[diff] computing shift-aware diff…`);
const sm = diffSmart(a.buf, b.buf);
const totalChanged = sm.runs.reduce((s, r) => s + Math.max(r.aEnd - r.aStart, r.bEnd - r.bStart), 0);
console.log(`  ${sm.runs.length} change-runs, ${totalChanged.toLocaleString()} bytes changed`);

// Build oracle for nearest-string annotation
console.log(`[oracle] indexing tokens…`);
const oracle = buildOracle({ saveBuf: a.buf, modDir: REPO_ROOT });
const annOff = []; const annLab = [];
for (const t of Object.values(oracle.tokens)) {
  for (const h of t.hits) {
    if (h.encoding !== "cstring" && h.encoding !== "utf8raw") continue;
    annOff.push(h.offset); annLab.push(`${t.token} [${t.kinds.join(",")}]`);
  }
}
const idx = annOff.map((_, i) => i).sort((p, q) => annOff[p] - annOff[q]);
const sortedOff = idx.map(i => annOff[i]);
const sortedLab = idx.map(i => annLab[i]);
function nearest(off) {
  let lo = 0, hi = sortedOff.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedOff[mid] <= off) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return null;
  return { offset: sortedOff[best], label: sortedLab[best], delta: off - sortedOff[best] };
}

// Find runs near "sparta" string
console.log(`\n[focus] sparta string offsets:`);
const spartaT = oracle.tokens["sparta"];
if (spartaT) {
  const top = spartaT.hits.filter(h => h.encoding === "cstring").slice(0, 10);
  for (const h of top) console.log(`  @0x${h.offset.toString(16)}`);
}
if (argosFaction) {
  const argosT = oracle.tokens[argosFaction];
  if (argosT) {
    console.log(`\n[focus] ${argosFaction} string offsets:`);
    const top = argosT.hits.filter(h => h.encoding === "cstring").slice(0, 10);
    for (const h of top) console.log(`  @0x${h.offset.toString(16)}`);
  }
}

// Top 30 longest runs
const runsByLen = sm.runs
  .map(r => ({ ...r, lenA: r.aEnd - r.aStart, lenB: r.bEnd - r.bStart, near: nearest(r.aStart) }))
  .sort((a, b) => Math.max(b.lenA, b.lenB) - Math.max(a.lenA, a.lenB))
  .slice(0, 30);
console.log(`\n[top 30 longest runs]`);
for (const r of runsByLen) {
  const len = Math.max(r.lenA, r.lenB);
  console.log(`  @0x${r.aStart.toString(16).padStart(8,"0")}  ${len.toString().padStart(5)}B  near: ${r.near ? `${r.near.label} (+${r.near.delta}B)` : "—"}`);
}

// Look for small-enum transitions in short runs near sparta/argos strings
console.log(`\n[short-run enum changes near sparta/argos strings]`);
const focusOffs = [];
if (oracle.tokens["sparta"]) for (const h of oracle.tokens["sparta"].hits) if (h.encoding === "cstring") focusOffs.push(h.offset);
if (argosFaction && oracle.tokens[argosFaction]) for (const h of oracle.tokens[argosFaction].hits) if (h.encoding === "cstring") focusOffs.push(h.offset);
const FOCUS_WIN = 4096;
const interestingByteChanges = [];
for (const fo of focusOffs) {
  for (let o = Math.max(0, fo - FOCUS_WIN); o < Math.min(a.size, fo + FOCUS_WIN); o++) {
    if (o >= b.size) break;
    if (a.buf[o] !== b.buf[o]) {
      const av = a.buf[o], bv = b.buf[o];
      // Filter for "enum-like" small transitions
      if (av < 32 && bv < 32 && av !== bv) {
        interestingByteChanges.push({ offset: o, av, bv, focus: fo, focusDelta: o - fo });
      }
    }
  }
}
const seen = new Set();
const uniq = interestingByteChanges.filter(x => { const k = x.offset; if (seen.has(k)) return false; seen.add(k); return true; });
uniq.sort((a, b) => Math.abs(a.focusDelta) - Math.abs(b.focusDelta));
for (const x of uniq.slice(0, 50)) {
  console.log(`  @0x${x.offset.toString(16)}  ${x.av} → ${x.bv}  (focus offset 0x${x.focus.toString(16)} Δ=${x.focusDelta})`);
}
