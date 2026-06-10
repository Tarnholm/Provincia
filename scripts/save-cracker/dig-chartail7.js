// dig-chartail7.js — cross-validate Marcus's transitions on Sparta T4→T5
// (1300 LAYOUT_B chars). LAYOUT_B has -4 offset shift so test:
//   - +18 (family link) → LAYOUT_B +14 (-4)  *** but LAYOUT_B has age@22 so anything < +22 might not shift uniformly
//   - +22 → LAYOUT_B +18
//   - +102 → LAYOUT_B +98
//   - +106 → LAYOUT_B +102
//   - +126 → LAYOUT_B +122
//   - +182 → LAYOUT_B +178
//   - +186 → LAYOUT_B +182
//   - +286 → LAYOUT_B +282

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

const A = fs.readFileSync(path.join(SAVES, "save_Autosave   Sparta   Turn 4 End.sav"));
const B = fs.readFileSync(path.join(SAVES, "save_Autosave   Sparta   Turn 5 Start.sav"));
const recsA = cp.findCharacterRecords(A, nameLookup, traitNames, null);
const recsB = cp.findCharacterRecords(B, nameLookup, traitNames, null);
const idxA = new Map();
for (const r of recsA) idxA.set(`${r.primaryUuid}`, r);

const aChars = [], bChars = [];
for (const rb of recsB) {
  const ra = idxA.get(`${rb.primaryUuid}`);
  if (!ra) continue;
  if (rb.lastName) aChars.push({ name: `${rb.firstName} ${rb.lastName}`, ra, rb });
  else bChars.push({ name: `${rb.firstName}`, ra, rb });
}

console.log(`# Sparta T4→T5: ${aChars.length} LAYOUT_A, ${bChars.length} LAYOUT_B`);

// Hyp 1: +102 / +98 = turn counter +1
// Hyp 2: +106 / +102 = turn counter
// Hyp 3: +126 / +122 = turn counter
// Hyp 4: +286 / +282 = +5 per turn (already CONFIRMED)
// Hyp 5: +182 / +178 = sentinel cleared at turn end (1→0)

function probe(label, charset, w, offA) {
  const transitions = new Map();
  let deltaSum = 0;
  let deltaCount = 0;
  for (const c of charset) {
    let vA, vB;
    if (w === 1) {
      vA = A.readUInt8(c.ra.offset + offA);
      vB = B.readUInt8(c.rb.offset + offA);
    } else if (w === 2) {
      vA = A.readUInt16LE(c.ra.offset + offA);
      vB = B.readUInt16LE(c.rb.offset + offA);
    } else {
      vA = A.readUInt32LE(c.ra.offset + offA);
      vB = B.readUInt32LE(c.rb.offset + offA);
    }
    if (vA !== vB && vB - vA < 1000 && vB - vA > -1000) {
      deltaSum += (vB - vA);
      deltaCount++;
    }
    const k = `${vA}→${vB}`;
    transitions.set(k, (transitions.get(k) || 0) + 1);
  }
  console.log(`\n${label}:`);
  for (const [k, v] of [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${k.padEnd(50)} ${v}x`);
  }
  if (deltaCount > 0) console.log(`  changed=${deltaCount}, avg delta=${(deltaSum/deltaCount).toFixed(2)}`);
}

console.log("\n=== LAYOUT_A (38 chars) ===");
probe("LAYOUT_A +102 u16", aChars, 2, 102);
probe("LAYOUT_A +106 u8", aChars, 1, 106);
probe("LAYOUT_A +126 u8", aChars, 1, 126);
probe("LAYOUT_A +182 u32", aChars, 4, 182);
probe("LAYOUT_A +286 u8 (control)", aChars, 1, 286);

console.log("\n=== LAYOUT_B (1300 chars) ===");
probe("LAYOUT_B +98 u16 (corresponds to LAYOUT_A +102)", bChars, 2, 98);
probe("LAYOUT_B +102 u8", bChars, 1, 102);
probe("LAYOUT_B +122 u8 (corresponds to LAYOUT_A +126)", bChars, 1, 122);
probe("LAYOUT_B +178 u32 (sentinel zone)", bChars, 4, 178);
probe("LAYOUT_B +282 u8 (control)", bChars, 1, 282);

// More detailed: in 1300 LAYOUT_B chars, count how many have +122 delta == +1
const distrib = {};
for (const c of bChars) {
  const vA = A.readUInt8(c.ra.offset + 122);
  const vB = B.readUInt8(c.rb.offset + 122);
  const d = vB - vA;
  if (Math.abs(d) > 30) continue; // ignore weird wraparounds
  distrib[d] = (distrib[d] || 0) + 1;
}
console.log(`\n## LAYOUT_B +122 delta distribution: ${JSON.stringify(distrib)}`);

// Same for +178
const d178 = {};
for (const c of bChars) {
  const vA = A.readUInt32LE(c.ra.offset + 178);
  const vB = B.readUInt32LE(c.rb.offset + 178);
  const dAvB = `${vA}→${vB}`;
  d178[dAvB] = (d178[dAvB] || 0) + 1;
}
const sorted178 = [...Object.entries(d178)].sort((a, b) => b[1] - a[1]).slice(0, 6);
console.log(`\n## LAYOUT_B +178 u32 top 6 transitions: ${sorted178.map(([k, v]) => `${k}:${v}`).join("  ")}`);
