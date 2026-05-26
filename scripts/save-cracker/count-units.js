// count-units.js — independent unit-count parser.
//
// Cross-checks findUnitRecords (src/unitParser.js) against an EDU-name-based
// occurrence scan. The structural parser validates name + region + UUID
// chain; the EDU scan trusts only the names. Big discrepancy ⇒ either:
//   * structural parser is missing record variants (naval, mercenary, fresh)
//   * EDU scan is over-counting via name fragments in unrelated payloads
//
// Both numbers feed save-budget-full.js as a sanity envelope around the unit
// component of the pointer-registry budget.
//
// Usage: node count-units.js <save.sav>

"use strict";

const fs = require("fs");
const path = require("path");
const { findUnitRecords } = require("../../src/unitParser.js");

const EDU_PATH = "C:/RIS/RIS/data/export_descr_unit.txt";
const SAVE = process.argv[2];
if (!SAVE) { console.error("usage: node count-units.js <save.sav>"); process.exit(1); }

// 1. Structural count via existing parser.
const buf = fs.readFileSync(SAVE);
const structural = findUnitRecords(buf);
console.log(`save: ${path.basename(SAVE)}`);
console.log(`size: ${(buf.length / (1024 * 1024)).toFixed(1)} MB`);
console.log();
console.log(`[1] structural parser (src/unitParser.js): ${structural.length} units`);

// 2. EDU-name based count. Look for each unit's name as a length-prefixed
//    ASCII pstr16 (the in-record encoding): `<u16 len> <ascii name> <null>`.
const edu = fs.readFileSync(EDU_PATH, "utf8");
const names = [];
for (const line of edu.split(/\r?\n/)) {
  const m = line.match(/^type\s+(.+?)\s*$/);
  if (m) names.push(m[1].trim());
}
console.log(`[2] EDU defines ${names.length} unit types`);

// pstr16 encoding in the save: u16 LE length (= name.length + 1 incl. null),
// then ASCII name, then a 0x00 byte. Build per-name occurrence count.
const tally = new Map();
let totalHits = 0;
for (const name of names) {
  const lenIncNull = name.length + 1;
  // sanity bounds — the structural parser allows 4..50.
  if (lenIncNull < 4 || lenIncNull > 50) { tally.set(name, 0); continue; }
  // Build the search prefix: [u16 lenIncNull][ASCII name][0x00]
  const probe = Buffer.alloc(2 + lenIncNull);
  probe.writeUInt16LE(lenIncNull, 0);
  probe.write(name, 2, "ascii");
  probe[probe.length - 1] = 0;
  let count = 0, p = 0;
  while ((p = buf.indexOf(probe, p)) >= 0) { count++; p += 2; }  // step 2 to allow overlapping pstr16s
  tally.set(name, count);
  totalHits += count;
}
console.log(`[2] EDU-name pstr16 hits: ${totalHits}`);

// 3. Per-name comparison: top 25 by hit count (the workhorses)
const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
console.log();
console.log("top 25 unit types by save occurrences:");
console.log("  " + "name".padEnd(45) + "count");
console.log("  " + "-".repeat(55));
for (const [name, n] of sorted.slice(0, 25)) {
  console.log("  " + name.padEnd(45) + n);
}

// 4. Match the structural parser's name list against the same tally.
//    For each name in structural[], confirm tally[name] > 0; surface any
//    structural-found-but-EDU-zero anomalies (would indicate stale EDU or
//    parser hallucination).
const structNames = new Set();
const structByName = new Map();
for (const r of structural) {
  structNames.add(r.name);
  structByName.set(r.name, (structByName.get(r.name) || 0) + 1);
}
console.log();
console.log(`distinct unit types found by structural parser: ${structNames.size}`);
let anomalies = 0;
for (const n of structNames) {
  if (!tally.has(n) || tally.get(n) === 0) anomalies++;
}
console.log(`structural-found but EDU-name-zero hits: ${anomalies} (parser hallucination check)`);

// 5. Identify which types the structural parser MISSES vs EDU scan.
let missedTotal = 0;
const missedSamples = [];
for (const [name, n] of tally) {
  if (n === 0) continue;
  const sc = structByName.get(name) || 0;
  if (sc < n) {
    const delta = n - sc;
    missedTotal += delta;
    if (missedSamples.length < 15) missedSamples.push({ name, struct: sc, edu: n, missed: delta });
  }
}
console.log();
console.log(`EDU hits NOT picked up by structural parser: ${missedTotal} (per-type below)`);
console.log("  " + "name".padEnd(45) + "struct  edu  missed");
console.log("  " + "-".repeat(70));
for (const m of missedSamples.sort((a, b) => b.missed - a.missed).slice(0, 15)) {
  console.log("  " + m.name.padEnd(45) + m.struct.toString().padStart(6) + "  " + m.edu.toString().padStart(3) + "  " + m.missed);
}
