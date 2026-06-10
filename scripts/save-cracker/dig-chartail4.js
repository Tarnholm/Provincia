// dig-chartail4.js — confirm +286 increment of +5 across Sparta T4→T5 boundary
// (a much bigger LAYOUT_B-dominated corpus). Also re-investigate LAYOUT_B +282.

const fs = require("fs");
const path = require("path");
const cp = require("../../src/characterParser.js");

const MOD = "C:/RIS/RIS/data";
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

function load(name) {
  return fs.readFileSync(path.join(SAVES, name));
}

const pairs = [
  ["save_Autosave   Sparta   Turn 4 End.sav", "save_Autosave   Sparta   Turn 5 Start.sav", "Sparta T4end→T5start"],
  ["save_rome6.sav", "save_rome7.sav", "Rome T5→T6"],
  ["save_Autosave   Athens   Turn 22 Start.sav", "save_Autosave   Athens   Turn 22 End.sav", "Athens T22start→T22end"],
];

for (const [aF, bF, label] of pairs) {
  console.log(`\n## ${label}: ${aF} → ${bF}`);
  const A = load(aF);
  const B = load(bF);
  const recsA = cp.findCharacterRecords(A, nameLookup, traitNames, null);
  const recsB = cp.findCharacterRecords(B, nameLookup, traitNames, null);
  const idxA = new Map();
  for (const r of recsA) idxA.set(`${r.primaryUuid}`, r);

  // For LAYOUT_A: check +286
  // For LAYOUT_B: check +282 (offset shift -4)
  const aDeltas = {};
  const bDeltas = {};
  let aCount = 0, bCount = 0;
  let aSamples = []; let bSamples = [];

  for (const rb of recsB) {
    const ra = idxA.get(`${rb.primaryUuid}`);
    if (!ra) continue;
    const layoutB = !rb.lastName;
    if (layoutB) {
      bCount++;
      const vA = A.readUInt8(ra.offset + 282);
      const vB = B.readUInt8(rb.offset + 282);
      const d = vB - vA;
      bDeltas[d] = (bDeltas[d] || 0) + 1;
      if (d !== 0 && bSamples.length < 8) bSamples.push({ name: `${rb.firstName}`, vA, vB });
    } else {
      aCount++;
      const vA = A.readUInt8(ra.offset + 286);
      const vB = B.readUInt8(rb.offset + 286);
      const d = vB - vA;
      aDeltas[d] = (aDeltas[d] || 0) + 1;
      if (d !== 0 && aSamples.length < 8) aSamples.push({ name: `${rb.firstName} ${rb.lastName}`, vA, vB });
    }
  }

  console.log(`  LAYOUT_A: ${aCount} chars  +286 deltas: ${Object.entries(aDeltas).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  LAYOUT_A samples: ${aSamples.map(s => `${s.name}(${s.vA}→${s.vB})`).join("; ")}`);
  console.log(`  LAYOUT_B: ${bCount} chars  +282 deltas: ${Object.entries(bDeltas).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  LAYOUT_B samples: ${bSamples.map(s => `${s.name}(${s.vA}→${s.vB})`).join("; ")}`);
}

// Also examine LAYOUT_B +282 specifically in rome6→rome7 (we know 15/911 incremented).
// Were they all by exactly +5?
console.log(`\n## Detailed LAYOUT_B +282 distribution in rome6→rome7`);
const A = load("save_rome6.sav");
const B = load("save_rome7.sav");
const recsA = cp.findCharacterRecords(A, nameLookup, traitNames, null);
const recsB = cp.findCharacterRecords(B, nameLookup, traitNames, null);
const idxA = new Map();
for (const r of recsA) idxA.set(`${r.primaryUuid}`, r);
const changed = [];
for (const rb of recsB) {
  const ra = idxA.get(`${rb.primaryUuid}`);
  if (!ra) continue;
  if (rb.lastName) continue;
  const vA = A.readUInt8(ra.offset + 282);
  const vB = B.readUInt8(rb.offset + 282);
  if (vA !== vB) changed.push({ name: `${rb.firstName}`, vA, vB, role: rb.role, traits: rb.traits.length, traitsA: ra.traits.length });
}
console.log(`# ${changed.length} LAYOUT_B chars with +282 change`);
for (const c of changed.slice(0, 20)) {
  console.log(`  ${c.name.padEnd(30)}  +282: ${c.vA}→${c.vB} (Δ${c.vB-c.vA})  role=${c.role}  traits=${c.traitsA}→${c.traits}`);
}
