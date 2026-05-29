"use strict";
// faction_relationships in descr_strat uses 199 (alliance), 200 (neutral default),
// 201 (war). These must be stored in the save somewhere. Search for the byte
// pattern (u32 factionA, u32 factionB, u32 type) where type is 199 or 201.
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves";
const buf = fs.readFileSync(path.join(SAVE_DIR, "save_antigonid turn1.sav"));

// Approach 1: scan EVERY u32 position. If it's 199 OR 201, check what u32s
// surround it. Real faction_relationships entries should be small numbers
// (faction indices 0..238).
console.log("=== u32=199 occurrences (with context) ===");
const hits199 = [];
for (let o = 0; o + 4 <= buf.length; o += 4) {
  if (buf.readUInt32LE(o) === 199) hits199.push(o);
}
console.log(`u32=199 count: ${hits199.length} (aligned)`);

const hits201 = [];
for (let o = 0; o + 4 <= buf.length; o += 4) {
  if (buf.readUInt32LE(o) === 201) hits201.push(o);
}
console.log(`u32=201 count: ${hits201.length} (aligned)`);

// Approach 2: Look for u32=199 or u32=201 cells preceded by two small u32s
// (faction indices). Antigonid has 6 alliances + 2 wars = 8 entries minimum.
// Look for clusters where 199/201 cells follow small (0..239) u32 values.
console.log("\n=== triples (smallA, smallB, 199_or_201) ===");
let goodCount = 0;
const triples = [];
for (let o = 8; o + 4 <= buf.length; o += 4) {
  const v = buf.readUInt32LE(o);
  if (v !== 199 && v !== 201) continue;
  const a = buf.readUInt32LE(o - 8);
  const b = buf.readUInt32LE(o - 4);
  if (a > 238 || b > 238) continue;
  if (a === b) continue;
  triples.push({ o, a, b, v });
  goodCount++;
  if (goodCount > 30) break;
}
console.log(`first ${triples.length} triples:`);
for (const t of triples) {
  console.log(`  off=${t.o}  ${t.a}, ${t.b}, ${t.v}`);
}

// Approach 3: maybe entries are (u32 factionA, u32 type, u32 factionB)?
console.log("\n=== triples (smallA, 199_or_201, smallB) — alternate layout ===");
let c2 = 0;
for (let o = 4; o + 8 <= buf.length; o += 4) {
  const v = buf.readUInt32LE(o);
  if (v !== 199 && v !== 201) continue;
  const a = buf.readUInt32LE(o - 4);
  const b = buf.readUInt32LE(o + 4);
  if (a > 238 || b > 238) continue;
  if (a === b) continue;
  console.log(`  off=${o}  ${a}, ${v}, ${b}`);
  c2++;
  if (c2 > 20) break;
}
