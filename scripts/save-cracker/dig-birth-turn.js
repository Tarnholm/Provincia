// dig-birth-turn.js — does the character record store birth turn?
// Hypothesis: birth_turn = current_turn - age_in_turns. For T0 (turn 1),
// AntigonosB (age 50) → birth_turn = 1 - 200 = -199 (= 0xff39 as u16).
// Scan +0..+296 for any field that matches this prediction per-char.

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
const chars = findCharacterRecords(buf, names, traits, null).filter(c => c.age && c.age > 0);

console.log(`Chars with age: ${chars.length}`);

// For T0, current_turn = 1. So birth_turn (in years) = 1 - age. In quarters: 1 - age*4.
// We'll scan ALL u16/u32 fields at every offset and see if any has high
// correlation with -c.age (or its quarter variant) across chars.

const layoutShift = (c) => c.lastName ? 4 : 0;

// For each offset 0..300, compute correlation of the field value with c.age
function corr(xs, ys) {
  const n = xs.length;
  if (n < 5) return 0;
  const mx = xs.reduce((a,b)=>a+b,0)/n;
  const my = ys.reduce((a,b)=>a+b,0)/n;
  let num=0,dx2=0,dy2=0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]-mx, dy = ys[i]-my;
    num += dx*dy; dx2 += dx*dx; dy2 += dy*dy;
  }
  return dx2===0||dy2===0 ? 0 : num/Math.sqrt(dx2*dy2);
}

const ages = [];
const valid = chars.filter(c => c.tileX != null && c.age != null);
console.log(`Chars with tile (used for confidence): ${valid.length}`);
const sampleChars = valid.slice(0, 200);

// Sample u16 at each offset
console.log("\nTop |correlations| of u16 field at +off with -age (any sign):");
const u16cors = [];
for (let off = 0; off < 300; off += 1) {
  const xs = [], ys = [];
  for (const c of sampleChars) {
    const shift = layoutShift(c);
    const o = c.offset + off + shift;
    if (o + 2 > buf.length) continue;
    let v = buf.readUInt16LE(o);
    // Treat as signed
    if (v >= 0x8000) v -= 0x10000;
    xs.push(v);
    ys.push(c.age);
  }
  const r = corr(xs, ys);
  if (Math.abs(r) > 0.5) u16cors.push({ off, r, n: xs.length });
}
u16cors.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
for (const c of u16cors.slice(0, 15)) console.log(`  +${c.off}: r=${c.r.toFixed(3)} (n=${c.n})`);

// Same for u32
console.log("\nTop |correlations| of u32 (signed) field at +off with -age:");
const u32cors = [];
for (let off = 0; off < 300; off += 1) {
  const xs = [], ys = [];
  for (const c of sampleChars) {
    const shift = layoutShift(c);
    const o = c.offset + off + shift;
    if (o + 4 > buf.length) continue;
    let v = buf.readInt32LE(o);
    if (Math.abs(v) > 100000) continue; // skip uuids/garbage
    xs.push(v);
    ys.push(c.age);
  }
  const r = corr(xs, ys);
  if (Math.abs(r) > 0.5) u32cors.push({ off, r, n: xs.length });
}
u32cors.sort((a,b) => Math.abs(b.r) - Math.abs(a.r));
for (const c of u32cors.slice(0, 15)) console.log(`  +${c.off}: r=${c.r.toFixed(3)} (n=${c.n})`);

// Specifically — is +22 (age byte) supplemented by +23..+25 (the "fe ff ff" run)
// or +14..+17 (one of the unknowns)?
console.log("\nManual: For AntigonosB (age 50), check all u16/u32 values that are -200 (= 0xff38):");
const ab = chars.find(c => c.firstName === "AntigonosB" || c.firstName === "Antigonos");
if (ab) {
  console.log(`AntigonosB @0x${ab.offset.toString(16)} age=${ab.age}`);
  const target200 = -200, target199 = -199, target201 = -201;
  for (let off = 0; off < 300; off++) {
    const o = ab.offset + off + (ab.lastName ? 4 : 0);
    if (o + 2 > buf.length) continue;
    let v16 = buf.readInt16LE(o);
    if (v16 === target200 || v16 === target199 || v16 === target201) {
      console.log(`  u16 @+${off}: ${v16}`);
    }
    if (o + 4 > buf.length) continue;
    let v32 = buf.readInt32LE(o);
    if (v32 === target200 || v32 === target199 || v32 === target201) {
      console.log(`  u32 @+${off}: ${v32}`);
    }
    // Also check 50 directly (= age in years)
    if (v16 === 50) console.log(`  u16 @+${off} = 50 (age in years?)`);
  }
}
