// dig-86-90-v2.js — refined analysis. v86/v90 are pairs of u16s.
// Quick check: does +92..+93 = 23 always?
// Then look at +86..+87 (u16 low_a), +88..+89 (u16 high_a), +90..+91 (u16 low_b).

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
const chars = findCharacterRecords(buf, names, traits, null);

const fields86_87 = new Map(); // value → count
const fields88_89 = new Map();
const fields90_91 = new Map();
const fields92_93 = new Map();

for (const c of chars) {
  const shift = c.lastName ? 4 : 0;
  const o = c.offset + 86 + shift;
  if (o + 8 > buf.length) continue;
  const a = buf.readUInt16LE(o);
  const b = buf.readUInt16LE(o + 2);
  const x = buf.readUInt16LE(o + 4);
  const y = buf.readUInt16LE(o + 6);
  fields86_87.set(a, (fields86_87.get(a) || 0) + 1);
  fields88_89.set(b, (fields88_89.get(b) || 0) + 1);
  fields90_91.set(x, (fields90_91.get(x) || 0) + 1);
  fields92_93.set(y, (fields92_93.get(y) || 0) + 1);
}

const top = (m) => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);

console.log("=== +86..+87 (u16) ===");
console.log(`  unique=${fields86_87.size}, top:`);
for (const [v, n] of top(fields86_87)) console.log(`    0x${v.toString(16).padStart(4,"0")} (${v}): ${n}`);

console.log("\n=== +88..+89 (u16) ===");
console.log(`  unique=${fields88_89.size}, top:`);
for (const [v, n] of top(fields88_89)) console.log(`    0x${v.toString(16).padStart(4,"0")} (${v}): ${n}`);

console.log("\n=== +90..+91 (u16) ===");
console.log(`  unique=${fields90_91.size}, top:`);
for (const [v, n] of top(fields90_91)) console.log(`    0x${v.toString(16).padStart(4,"0")} (${v}): ${n}`);

console.log("\n=== +92..+93 (u16) — predicted constant = 23 ===");
console.log(`  unique=${fields92_93.size}, top:`);
for (const [v, n] of top(fields92_93)) console.log(`    0x${v.toString(16).padStart(4,"0")} (${v}): ${n}`);

// For +88..+89 values 1,2,3 — what characters get each value?
console.log("\n=== Char distribution by +88..+89 value ===");
const buckets = new Map();
for (const c of chars) {
  const shift = c.lastName ? 4 : 0;
  const v = buf.readUInt16LE(c.offset + 88 + shift);
  if (!buckets.has(v)) buckets.set(v, []);
  buckets.get(v).push(c);
}
for (const [v, list] of [...buckets.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,6)) {
  console.log(`\n  +88..+89 = ${v} (${list.length} chars):`);
  const sample = list.slice(0, 8);
  for (const c of sample) {
    const dead = c.isDead ? " DEAD" : "";
    const role = c.role != null ? ` r${c.role}` : "";
    const cmd = c.command != null ? ` cmd${c.command}` : "";
    const layout = c.lastName ? "A" : "B";
    const tcnt = (c.traits||[]).length;
    console.log(`    ${c.firstName}${c.lastName?" "+c.lastName:""} ${c.age}y ${c.gender || "?"}${dead}${role}${cmd} t=${tcnt} ${layout}`);
  }
}

// Does +86..+87 correlate with traitCount?
console.log("\n=== Does +86..+87 = traitCount? ===");
let match86 = 0, mismatch86 = 0;
for (const c of chars) {
  const shift = c.lastName ? 4 : 0;
  const v = buf.readUInt16LE(c.offset + 86 + shift);
  const tc = (c.traits||[]).length;
  if (v === tc) match86++; else mismatch86++;
}
console.log(`  match: ${match86}, mismatch: ${mismatch86}`);

// Does +86..+87 match traitCount*something?
console.log("\n=== Sample: +86..+87 / traitCount ===");
const ratios = [];
for (const c of chars.slice(0, 30)) {
  const shift = c.lastName ? 4 : 0;
  const v = buf.readUInt16LE(c.offset + 86 + shift);
  const tc = (c.traits||[]).length;
  if (tc > 0) ratios.push(v / tc);
  console.log(`  ${(c.firstName+(c.lastName?" "+c.lastName:"")).padEnd(28)} v86_lo=${v.toString().padStart(5)} traits=${tc.toString().padStart(3)} v/t=${tc>0?(v/tc).toFixed(2):"-"}`);
}

// What if +86..+87 is a HASH of something? Test: does it match anywhere in file?
// Just count occurrences of each top value in the entire buffer
console.log("\n=== Where else in save does +86..+87 = 3115 (AntigonosB's value) appear? ===");
const target = 3115;
let hits = 0;
const sample = [];
for (let i = 0; i < buf.length - 2; i++) {
  if (buf.readUInt16LE(i) === target) { hits++; if (sample.length < 10) sample.push(i); }
}
console.log(`  total hits in 32MB save: ${hits}`);
console.log(`  first 10 offsets: ${sample.map(o => "0x"+o.toString(16)).join(", ")}`);
