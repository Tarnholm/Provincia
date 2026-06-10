// dig-chartail2.js — investigate +286 and +299 transitions across all LAYOUT_A
// chars in rome6→rome7 turn boundary. Hypothesis: +286 is some per-character
// counter (trait-gain count, commission count, or battle count) that ticks at
// turn end.
//
// Also probe LAYOUT_B equivalent offsets (-4 shift, so +282, +295) for parity.

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

const A = fs.readFileSync(path.join(SAVES, "save_rome6.sav"));
const B = fs.readFileSync(path.join(SAVES, "save_rome7.sav"));
const recsA = cp.findCharacterRecords(A, nameLookup, traitNames, null);
const recsB = cp.findCharacterRecords(B, nameLookup, traitNames, null);

function ukey(r) { return `${r.primaryUuid}`; }
const idxA = new Map();
for (const r of recsA) idxA.set(ukey(r), r);

// For each pair, compute (traitCount delta, +286 delta for LAYOUT_A / +282 LAYOUT_B)
// Note: parsed records don't expose layout — infer from has-lastName
console.log("# rome6→rome7 character record interior changes");
console.log("# layout A: traitCount @+302, candidate tail bytes +219..+301");
console.log("# layout B: traitCount @+298, candidate tail bytes +215..+297");

let aChars = 0, bChars = 0;
const trDelta286 = [];   // trait delta vs +286 delta for LAYOUT_A
const trDelta282 = [];   // for LAYOUT_B
const cntA286 = { same: 0, increased: 0, decreased: 0 };
const cntB282 = { same: 0, increased: 0, decreased: 0 };

for (const rb of recsB) {
  const ra = idxA.get(ukey(rb));
  if (!ra) continue;
  const layoutB = !rb.lastName;
  const tcOff = layoutB ? 298 : 302;
  const tailA = layoutB ? 282 : 286;
  const tailB = layoutB ? 295 : 299;
  if (layoutB) bChars++; else aChars++;

  const tcA = A.readUInt16LE(ra.offset + tcOff);
  const tcB = B.readUInt16LE(rb.offset + tcOff);
  const trDelta = tcB - tcA;

  const vA = A.readUInt8(ra.offset + tailA);
  const vB = B.readUInt8(rb.offset + tailA);
  const delta = vB - vA;
  if (layoutB) {
    trDelta282.push({ key: ukey(rb), name: `${rb.firstName} ${rb.lastName || ""}`, trDelta, vA, vB, delta });
    if (vA === vB) cntB282.same++;
    else if (vB > vA) cntB282.increased++;
    else cntB282.decreased++;
  } else {
    trDelta286.push({ key: ukey(rb), name: `${rb.firstName} ${rb.lastName || ""}`, trDelta, vA, vB, delta });
    if (vA === vB) cntA286.same++;
    else if (vB > vA) cntA286.increased++;
    else cntA286.decreased++;
  }
}

console.log(`\n## LAYOUT_A (${aChars} chars) at +286`);
console.log(`  same=${cntA286.same}  increased=${cntA286.increased}  decreased=${cntA286.decreased}`);

console.log(`\n## LAYOUT_B (${bChars} chars) at +282`);
console.log(`  same=${cntB282.same}  increased=${cntB282.increased}  decreased=${cntB282.decreased}`);

// Show characters where +286 jumped a lot (likely battle wins / commissions)
console.log(`\n## LAYOUT_A characters with +286 delta != 0`);
for (const c of trDelta286.filter(c => c.delta !== 0).slice(0, 30)) {
  console.log(`  ${c.name.padEnd(40)}  +286: ${c.vA} → ${c.vB} (delta=${c.delta})  traits: ${c.trDelta >= 0 ? "+" + c.trDelta : c.trDelta}`);
}

// Correlation: does +286 delta equal trait delta?
console.log(`\n## Correlation: +286 delta vs trait delta (LAYOUT_A only)`);
const corrMap = new Map(); // (286delta, trDelta) -> count
for (const c of trDelta286) {
  const k = `${c.delta},${c.trDelta}`;
  corrMap.set(k, (corrMap.get(k) || 0) + 1);
}
const corr = [...corrMap.entries()].sort((a, b) => b[1] - a[1]);
for (const [k, v] of corr.slice(0, 12)) {
  const [d, td] = k.split(",").map(Number);
  console.log(`  +286 delta=${d.toString().padStart(4)}  trait delta=${td.toString().padStart(4)}  count=${v}`);
}

// Sample: characters with biggest trait gains
console.log(`\n## LAYOUT_A: top 10 trait gainers between rome6→rome7`);
trDelta286.sort((a, b) => b.trDelta - a.trDelta);
for (const c of trDelta286.slice(0, 10)) {
  console.log(`  ${c.name.padEnd(40)}  traits delta=${c.trDelta}  +286: ${c.vA}→${c.vB}`);
}
