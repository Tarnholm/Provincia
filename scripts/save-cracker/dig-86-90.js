// dig-86-90.js — try to identify what +86 (u32) and +90 (u32) of LAYOUT_B
// character records actually hold.
//
// Hypotheses to test:
//   H1: birth turn (turn number when character was born/joined)
//   H2: scripted-event counter
//   H3: experience / battles won
//   H4: ancillary / vnv-related count
//   H5: file-offset back-pointer
//   H6: random RNG seed (would show no correlation with anything)

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

console.log(`Total v1 chars: ${chars.length}`);

// Determine layout for each char (LAYOUT_A has lastName, LAYOUT_B does not).
// +86 / +90 offsets shift by +4 in LAYOUT_A.
function readPair(c) {
  const layoutShift = c.lastName ? 4 : 0;
  const o86 = c.offset + 86 + layoutShift;
  const o90 = c.offset + 90 + layoutShift;
  if (o86 + 4 > buf.length || o90 + 4 > buf.length) return null;
  return {
    v86: buf.readUInt32LE(o86),
    v90: buf.readUInt32LE(o90),
    o86, o90,
  };
}

const rows = [];
for (const c of chars) {
  const p = readPair(c);
  if (!p) continue;
  rows.push({
    name: (c.firstName || "?") + (c.lastName ? " " + c.lastName : ""),
    age: c.age,
    role: c.role,
    isDead: c.isDead,
    layout: c.lastName ? "A" : "B",
    traitCount: (c.traits || []).length,
    cmd: c.command,
    inf: c.influence,
    mgmt: c.management,
    loy: c.loyalty,
    offset: c.offset,
    v86: p.v86, v90: p.v90, o86: p.o86, o90: p.o90,
  });
}

console.log(`Pairs read: ${rows.length}\n`);

// Stats
const valsAll = (sel) => rows.map(sel).filter(v => v != null && v < 0xffffffff);
const v86s = valsAll(r => r.v86);
const v90s = valsAll(r => r.v90);
console.log("=== +86 (u32) stats ===");
console.log(`  min=${Math.min(...v86s)} max=${Math.max(...v86s)} unique=${new Set(v86s).size}`);
console.log(`  zero=${v86s.filter(v => v === 0).length} small(<256)=${v86s.filter(v => v < 256).length}`);
console.log("=== +90 (u32) stats ===");
console.log(`  min=${Math.min(...v90s)} max=${Math.max(...v90s)} unique=${new Set(v90s).size}`);
console.log(`  zero=${v90s.filter(v => v === 0).length}`);

// Sample table
console.log("\n=== Sample of 30 chars: name age v86 v90 traitCount cmd inf ===");
const sample = rows.slice(0, 30);
for (const r of sample) {
  console.log(
    `  ${r.name.padEnd(28)} ${String(r.age).padStart(3)}y  ` +
    `v86=${String(r.v86).padStart(10)}  v90=${String(r.v90).padStart(10)}  ` +
    `traits=${r.traitCount}  cmd=${r.cmd}  layout=${r.layout}  off=0x${r.offset.toString(16)}`
  );
}

// Correlation tests
function corr(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}

const fields = ["age", "role", "traitCount", "cmd", "inf", "mgmt", "loy", "offset"];
console.log("\n=== Correlations of v86 / v90 with known fields ===");
for (const f of fields) {
  const valid = rows.filter(r => r[f] != null && r.v86 != null && r.v90 != null && r.v86 < 0x10000000 && r.v90 < 0x10000000);
  if (valid.length < 5) continue;
  const c86 = corr(valid.map(r => r.v86), valid.map(r => r[f]));
  const c90 = corr(valid.map(r => r.v90), valid.map(r => r[f]));
  console.log(`  ${f.padEnd(12)}: corr(v86) = ${c86.toFixed(3)}   corr(v90) = ${c90.toFixed(3)}`);
}

// Does v86 == offset back-pointer? Check (v86 ≈ record_offset)
console.log("\n=== Does v86 or v90 look like a back-pointer to record offset ===");
let matches86 = 0, matches90 = 0;
for (const r of rows) {
  if (Math.abs(r.v86 - r.offset) < 4) matches86++;
  if (Math.abs(r.v90 - r.offset) < 4) matches90++;
}
console.log(`  v86 within 4 of offset: ${matches86}/${rows.length}`);
console.log(`  v90 within 4 of offset: ${matches90}/${rows.length}`);

// Does v86 / v90 match any uuid we know about?
const knownUuids = new Set();
for (const c of chars) {
  if (c.primaryUuid) knownUuids.add(c.primaryUuid);
  if (c.secondaryUuid) knownUuids.add(c.secondaryUuid);
  for (const ch of (c.childUuids || [])) if (ch && ch !== 0xffffffff) knownUuids.add(ch);
}
let v86Uuid = 0, v90Uuid = 0;
for (const r of rows) {
  if (knownUuids.has(r.v86)) v86Uuid++;
  if (knownUuids.has(r.v90)) v90Uuid++;
}
console.log(`  v86 matches some known uuid: ${v86Uuid}/${rows.length}`);
console.log(`  v90 matches some known uuid: ${v90Uuid}/${rows.length}`);

// Look at variance: are v86 / v90 mostly the same across nearby chars?
// (i.e., maybe they're file-offset-derived and ALL chars share the same value
// because they're computed from a global like "current_turn")
const v86Top = {}, v90Top = {};
for (const r of rows) {
  v86Top[r.v86] = (v86Top[r.v86] || 0) + 1;
  v90Top[r.v90] = (v90Top[r.v90] || 0) + 1;
}
const topN = (obj) => Object.entries(obj).sort((a,b) => b[1]-a[1]).slice(0,5);
console.log("\n=== Top 5 most common v86 values ===");
for (const [v, n] of topN(v86Top)) console.log(`  ${v} (0x${parseInt(v).toString(16)}) appears ${n} times`);
console.log("=== Top 5 most common v90 values ===");
for (const [v, n] of topN(v90Top)) console.log(`  ${v} (0x${parseInt(v).toString(16)}) appears ${n} times`);
