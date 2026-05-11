// Find Sakon Taphai's tax rate field. Save_3 was the only Saka variant where
// tax was changed (Sakon Taphai → high). Default tax level in RTW is normal=1,
// high=2 — so we expect a single byte to change from 1 → 2.
//
// Strategy:
//  1. byte-diff baseline vs save_3
//  2. filter: only positions where baseline byte = 1 AND save_3 byte = 2
//  3. then exclude positions that ALSO changed in the other 6 Saka variants
//     (those are engine noise / unrelated). The remaining offsets are
//     pair_3-specific 1→2 transitions = tax candidates.
//  4. validate by cross-checking each candidate's neighborhood for
//     settlement-record-like context.
import fs from "node:fs";
import path from "node:path";

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const baseline = fs.readFileSync(path.join(SAVE_DIR, "save_1turnstart.sav"));

const variants = {
  "1": "save_1turnchange.sav",
  "2": "save_2.sav",
  "3": "save_3.sav",
  "4": "save_4.sav",
  "5": "save_5.sav",
  "6": "save_6.sav",
  "7": "save_7.sav",
};
const bufs = {};
for (const [k, f] of Object.entries(variants)) bufs[k] = fs.readFileSync(path.join(SAVE_DIR, f));

console.log(`baseline: ${baseline.length.toLocaleString()}`);
for (const [k, b] of Object.entries(bufs)) console.log(`save_${k}: ${b.length.toLocaleString()} (Δ ${b.length - baseline.length})`);

// Step 1+2: for save_3, find all positions where baseline=1 AND save_3=2
const v3 = bufs["3"];
const cap = Math.min(baseline.length, v3.length);
const candidatesByPair = {};
for (const [k, b] of Object.entries(bufs)) candidatesByPair[k] = new Set();

for (let i = 0; i < cap; i++) {
  if (baseline[i] === 1 && v3[i] === 2) candidatesByPair["3"].add(i);
}
console.log(`\nbaseline=1 → save_3=2 candidates: ${candidatesByPair["3"].size.toLocaleString()}`);

// Step 3: exclude positions that ALSO changed in any other variant
const otherChanged = new Set();
for (const [k, b] of Object.entries(bufs)) {
  if (k === "3") continue;
  const cap2 = Math.min(baseline.length, b.length);
  for (const off of candidatesByPair["3"]) {
    if (off < cap2 && baseline[off] !== b[off]) otherChanged.add(off);
  }
}
const exclusiveTo3 = [...candidatesByPair["3"]].filter(o => !otherChanged.has(o));
console.log(`exclusive-to-save_3 (not changed in any other variant): ${exclusiveTo3.length}`);

// Stronger filter: also require the byte to be EQUAL across other variants
// (not changed AT ALL). Some bytes may have changed to different values in other
// variants — those are engine noise affecting save_3 only by coincidence.
const stable = exclusiveTo3.filter(o => {
  for (const [k, b] of Object.entries(bufs)) {
    if (k === "3") continue;
    if (o >= b.length) return false;
    if (b[o] !== baseline[o]) return false; // differs in another variant
  }
  return true;
});
console.log(`save_3-exclusive AND constant in all other variants: ${stable.length}`);
console.log(`(this is the candidate pool for "Sakon Taphai tax field")\n`);

// Show top 30 candidates with byte context
console.log(`[top ${Math.min(30, stable.length)} candidates]`);
for (const off of stable.slice(0, 30)) {
  const ctx = Array.from(baseline.subarray(Math.max(0, off - 4), Math.min(baseline.length, off + 12)))
    .map(b => b.toString(16).padStart(2, "0")).join(" ");
  const ctx3 = Array.from(v3.subarray(Math.max(0, off - 4), Math.min(v3.length, off + 12)))
    .map(b => b.toString(16).padStart(2, "0")).join(" ");
  // ASCII near
  const asc = Array.from(baseline.subarray(Math.max(0, off - 16), Math.min(baseline.length, off + 16)))
    .map(b => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
  console.log(`  @0x${off.toString(16).padStart(8,"0")}  baseline: ${ctx}  →  save_3: ${ctx3}    ascii: ${asc}`);
}

// Try to find "Sakon_Taphai" in the save (it's a region name — the user said
// region 13 = Sakaia, Sakon Taphai is the city in that region)
// Region/city names are NOT stored as strings per our earlier finding, so
// expect 0 hits.
const probes = ["Sakon_Taphai", "Sakon", "Taphai", "Sakaia", "saka"];
for (const p of probes) {
  const u8 = Buffer.from(p, "utf-8");
  let count = 0, from = 0;
  while (true) {
    const i = baseline.indexOf(u8, from);
    if (i < 0) break;
    count++; from = i + 1;
    if (count > 50) break;
  }
  console.log(`"${p}" cstring hits: ${count}`);
}
