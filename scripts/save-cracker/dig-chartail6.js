// dig-chartail6.js — investigate Marcus's other transitions:
// +18..+25 (family link from 0xff sentinel to real data), +106 (counter
// 2→4), +126 (counter 6→5), +182..+185 (sentinel cleared).
//
// Cross-validate across all LAYOUT_A chars in rome6→rome7 and see if any
// of these are universal turn-boundary changes vs character-specific.

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
const idxA = new Map();
for (const r of recsA) idxA.set(`${r.primaryUuid}`, r);

// For all LAYOUT_A chars, classify each byte +0..+302 by per-char behavior
console.log(`# 25 LAYOUT_A chars in rome6→rome7, byte-level diff per character`);
const aChars = [];
for (const rb of recsB) {
  const ra = idxA.get(`${rb.primaryUuid}`);
  if (!ra || rb.lastName === null) continue;
  if (!rb.lastName) continue;
  aChars.push({ name: `${rb.firstName} ${rb.lastName}`, ra, rb });
}
console.log(`# ${aChars.length} chars\n`);

// Bytes to investigate
const probes = [
  { name: "+18 u32 (family link)", rel: 18, w: 4 },
  { name: "+22 u32 (family link continued)", rel: 22, w: 4 },
  { name: "+106", rel: 106, w: 1 },
  { name: "+126", rel: 126, w: 1 },
  { name: "+182 u32 (sentinel zone)", rel: 182, w: 4 },
  { name: "+186 u32", rel: 186, w: 4 },
  { name: "+190 u32", rel: 190, w: 4 },
  { name: "+286 (CONFIRMED turn counter)", rel: 286, w: 1 },
  { name: "+87 (age high byte)", rel: 87, w: 1 },
  { name: "+102 u16", rel: 102, w: 2 },
];

for (const p of probes) {
  const transitions = new Map(); // (vA,vB) -> count
  for (const c of aChars) {
    let vA, vB;
    if (p.w === 1) {
      vA = A.readUInt8(c.ra.offset + p.rel);
      vB = B.readUInt8(c.rb.offset + p.rel);
    } else if (p.w === 2) {
      vA = A.readUInt16LE(c.ra.offset + p.rel);
      vB = B.readUInt16LE(c.rb.offset + p.rel);
    } else {
      vA = A.readUInt32LE(c.ra.offset + p.rel);
      vB = B.readUInt32LE(c.rb.offset + p.rel);
    }
    const k = `${vA}→${vB}`;
    transitions.set(k, (transitions.get(k) || 0) + 1);
  }
  console.log(`\n${p.name}:`);
  for (const [k, v] of [...transitions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${k.padEnd(40)} ${v}x`);
  }
}

// Look at +18..+25 specifically: who has these transition from 0xff sentinel
// to a real value? List them. The 8 bytes are a name index pair.
console.log(`\n## +18..+25 family link details (LAYOUT_A)`);
for (const c of aChars) {
  const u32A_18 = A.readUInt32LE(c.ra.offset + 18);
  const u32A_22 = A.readUInt32LE(c.ra.offset + 22);
  const u32B_18 = B.readUInt32LE(c.rb.offset + 18);
  const u32B_22 = B.readUInt32LE(c.rb.offset + 22);
  if (u32A_18 !== u32B_18 || u32A_22 !== u32B_22) {
    const labelA_18 = u32A_18 === 0xffffffff ? "0xff_sentinel" : `${u32A_18} (${nameLookup[u32A_18] || "?"})`;
    const labelB_18 = u32B_18 === 0xffffffff ? "0xff_sentinel" : `${u32B_18} (${nameLookup[u32B_18] || "?"})`;
    const labelA_22 = u32A_22 === 0xffffffff ? "0xff_sentinel" : `${u32A_22}`;
    const labelB_22 = u32B_22 === 0xffffffff ? "0xff_sentinel" : `${u32B_22}`;
    console.log(`  ${c.name.padEnd(40)}  +18: ${labelA_18}→${labelB_18}  +22: ${labelA_22}→${labelB_22}`);
  }
}
