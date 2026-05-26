// dig-vnv-block.js — analyze the 172-byte sparse block at +126..+297 of
// LAYOUT_B character records. Goal: identify what fields live there.

"use strict";
const fs = require("fs");
const path = require("path");
const savePath = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_macedon t0.sav";
const modPath = "C:/RIS/RIS";
const names = fs.readFileSync(path.join(modPath, "data/descr_names_lookup.txt"), "utf8").split(/\r?\n/).map(s => s.trim());
const traits = [];
for (const m of fs.readFileSync(path.join(modPath, "data/export_descr_character_traits.txt"), "utf8").matchAll(/^Trait\s+([A-Za-z0-9_]+)/gm)) traits.push(m[1]);
const { findCharacterRecords } = require("../../src/characterParser.js");
const buf = fs.readFileSync(savePath);
const chars = findCharacterRecords(buf, names, traits, null).filter(c => c.age != null);

// Pick well-characterized LAYOUT_B chars with traits + tile
const sample = chars.filter(c => !c.lastName && c.tileX != null && (c.traits||[]).length > 0).slice(0, 200);
console.log(`Sample: ${sample.length} LAYOUT_B chars\n`);

// Per-byte: how many distinct values across sample?
const byteUniq = new Array(172).fill(0).map(()=>new Set());
const byteZero = new Array(172).fill(0);
const byteSum = new Array(172).fill(0);

for (const c of sample) {
  for (let i = 0; i < 172; i++) {
    const b = buf[c.offset + 126 + i];
    byteUniq[i].add(b);
    byteSum[i] += b;
    if (b === 0) byteZero[i]++;
  }
}

console.log("Offset  Uniq  Zero%  Mean  | Hypothesis");
for (let i = 0; i < 172; i++) {
  const off = 126 + i;
  const u = byteUniq[i].size;
  const zp = ((byteZero[i] / sample.length) * 100).toFixed(0);
  const mean = (byteSum[i] / sample.length).toFixed(1);
  let hyp = "";
  if (u === 1) hyp = `CONSTANT 0x${[...byteUniq[i]][0].toString(16).padStart(2,"0")}`;
  else if (u <= 4) hyp = `small enum ${[...byteUniq[i]].sort((a,b)=>a-b).map(v=>v.toString()).join(",")}`;
  else if (u <= 16) hyp = "small range";
  else if (u > 100) hyp = "high entropy";
  console.log(`+${off.toString().padStart(3," ")} (${i.toString().padStart(3)})  ${u.toString().padStart(3)}  ${zp.padStart(3)}%  ${mean.padStart(5)} | ${hyp}`);
}

// Look at u16 patterns
console.log("\n=== Top u16 values at each even offset in block ===");
for (let i = 0; i < 168; i += 2) {
  const m = new Map();
  for (const c of sample) {
    const v = buf.readUInt16LE(c.offset + 126 + i);
    m.set(v, (m.get(v) || 0) + 1);
  }
  // Only print if has interesting distribution
  if (m.size <= 1) continue;
  if (m.size > 50) continue;
  const top = [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 4);
  if (top[0][0] === 0 && top[0][1] > sample.length * 0.95) continue; // mostly zero
  const display = top.map(([v,n]) => `${v}(${n})`).join("  ");
  console.log(`  +${126+i}: unique=${m.size} top=${display}`);
}

// Save raw block hex dump for 3 characters with very different trait counts
console.log("\n=== Hex dump of vnv block for 3 chars ===");
const cmp = [
  sample.find(c => c.firstName === "AntigonosB"),
  sample.find(c => c.firstName === "DemetriosC"),
  sample.find(c => c.firstName === "Halkyoneus"),
].filter(Boolean);
for (const c of cmp) {
  console.log(`\n${c.firstName} (age ${c.age}, traits=${(c.traits||[]).length})`);
  for (let i = 0; i < 172; i += 16) {
    const row = [];
    for (let j = 0; j < 16 && (i+j) < 172; j++) {
      row.push(buf[c.offset + 126 + i + j].toString(16).padStart(2,"0"));
    }
    console.log(`  +${126+i}: ${row.join(" ")}`);
  }
}
