// dig-chartail3.js — confirm session 4's HYPOTHESIS that +218 increments by +5
// each turn, AND check +286 for the same pattern. Also examine the +299 u32
// transition (could be year/turn snapshot).
//
// Method:
//   - Trace LAYOUT_A characters at +218 and +286 across all rome saves
//     (rome1..rome6 = turn 5, rome7..rome9 = turn 6).
//   - Same char between rome1..rome6 should be CONSTANT (within-turn moves only).
//   - Same char between rome6→rome7 should increment by uniform +5.
//   - For chars present in rome7→rome8→rome9 (within turn 6, no movement), should
//     stay constant.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/Mods/My Mods/RIS beta/data";
const SAVES = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";

const nameLookup = fs.readFileSync(path.join(MOD, "descr_names_lookup.txt"), "utf8")
  .split(/\r?\n/).map(s => s.trim());
const traitNames = [];
{
  const lines = fs.readFileSync(path.join(MOD, "export_descr_character_traits.txt"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const tm = line.match(/^Trait\s+(\S+)/);
    if (tm) traitNames.push(tm[1]);
  }
}

const ROMES = ["save_rome1.sav", "save_rome2.sav", "save_rome3.sav", "save_rome4.sav",
  "save_rome5..sav", "save_rome6.sav", "save_rome7.sav", "save_rome8.sav", "save_rome9.sav"];
const bufs = ROMES.map(f => fs.readFileSync(path.join(SAVES, f)));
const allRecs = bufs.map(buf => cp.findCharacterRecords(buf, nameLookup, traitNames, null));

function ukey(r) { return `${r.primaryUuid}`; }

// Build per-uuid traces across the 9 saves
const traces = new Map();
for (let i = 0; i < 9; i++) {
  for (const r of allRecs[i]) {
    if (!traces.has(ukey(r))) traces.set(ukey(r), {});
    traces.get(ukey(r))[i] = r;
  }
}

// For each LAYOUT_A character present in all 9 saves: read +218, +286, +298 across the 9 saves
console.log("# LAYOUT_A characters present in all 9 saves: +218, +286, +298 traces");
console.log("# col headers: rome1 rome2 rome3 rome4 rome5 rome6 rome7 rome8 rome9");

let aFull = 0;
const trace218 = [];
const trace286 = [];
let lastReportedName = "";

for (const [uuid, slots] of traces) {
  let allPresent = true;
  let layoutA = false;
  for (let i = 0; i < 9; i++) {
    if (!slots[i]) { allPresent = false; break; }
    if (slots[i].lastName) layoutA = true;
  }
  if (!allPresent || !layoutA) continue;
  aFull++;
  const r0 = slots[0];
  const name = `${r0.firstName} ${r0.lastName || ""}`;
  const t218 = [];
  const t286 = [];
  for (let i = 0; i < 9; i++) {
    t218.push(bufs[i].readUInt8(slots[i].offset + 218));
    t286.push(bufs[i].readUInt8(slots[i].offset + 286));
  }
  trace218.push({ name, t: t218 });
  trace286.push({ name, t: t286 });
}

console.log(`\n## ${aFull} LAYOUT_A characters present in all 9 saves`);
console.log(`\n## +218 traces (first 15)`);
for (const c of trace218.slice(0, 15)) {
  console.log(`  ${c.name.padEnd(40)}: [${c.t.join(",")}]`);
}

console.log(`\n## +286 traces (first 15)`);
for (const c of trace286.slice(0, 15)) {
  console.log(`  ${c.name.padEnd(40)}: [${c.t.join(",")}]`);
}

// Compute per-char delta histograms for both
function deltas(arr) {
  return arr.slice(1).map((v, i) => v - arr[i]);
}

console.log(`\n## +218 deltas per turn boundary`);
console.log(`# slot indices: 0=r1→r2, 1=r2→r3, 2=r3→r4, 3=r4→r5, 4=r5→r6, 5=r6→r7, 6=r7→r8, 7=r8→r9`);
const dh218 = [{}, {}, {}, {}, {}, {}, {}, {}];
for (const c of trace218) {
  const ds = deltas(c.t);
  for (let i = 0; i < 8; i++) {
    const k = ds[i];
    dh218[i][k] = (dh218[i][k] || 0) + 1;
  }
}
for (let i = 0; i < 8; i++) {
  const entries = Object.entries(dh218[i]).sort((a, b) => b[1] - a[1]);
  console.log(`  step ${i}: ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

console.log(`\n## +286 deltas per turn boundary`);
const dh286 = [{}, {}, {}, {}, {}, {}, {}, {}];
for (const c of trace286) {
  const ds = deltas(c.t);
  for (let i = 0; i < 8; i++) {
    const k = ds[i];
    dh286[i][k] = (dh286[i][k] || 0) + 1;
  }
}
for (let i = 0; i < 8; i++) {
  const entries = Object.entries(dh286[i]).sort((a, b) => b[1] - a[1]);
  console.log(`  step ${i}: ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

// Specifically focus on Marcus Livius_Drusus's record bytes +219..+301 across all 9 saves
console.log(`\n## Marcus Livius_Drusus byte-by-byte +219..+301 across rome1..rome9`);
const marcus = trace218.find(c => c.name.includes("Marcus Livius"));
if (marcus) {
  // refetch full uuid
  let muuid = null;
  for (const [u, slots] of traces) {
    if (slots[0] && slots[0].firstName === "Marcus" && slots[0].lastName === "Livius_Drusus") {
      muuid = u;
      break;
    }
  }
  if (muuid) {
    const mslots = traces.get(muuid);
    console.log(`# uuid=${muuid}  layoutA`);
    for (let rel = 219; rel <= 301; rel++) {
      const vals = [];
      for (let i = 0; i < 9; i++) vals.push(bufs[i].readUInt8(mslots[i].offset + rel));
      const uniq = new Set(vals);
      if (uniq.size > 1) {
        console.log(`  +${rel.toString().padStart(3)}: [${vals.join(",")}]  uniq=${uniq.size}`);
      }
    }
  }
}
