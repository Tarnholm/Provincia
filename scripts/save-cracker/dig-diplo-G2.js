// dig-diplo-G2.js — session 109 follow-up to G
//
// G found: the 148B pre-marker zone has 0 cross-major pointers and 0
// matches against the entry-A pool. So the OTHER faction in each relation
// is NOT there.
//
// Re-examine the 16-byte entry itself. Maybe A is structured (u16+u16,
// u8×4, etc.):
//   * As 2× u16: low-u16 ∈ [0..22] could be a major-index pair
//   * As 4× u8: byte[0] could be the partner
//   * As a hash that decodes via lookup elsewhere
//
// Also: D = 0x00010101 might actually be (a, b, c) bytes where a/b/c are
// flags. Re-parse it as 4×u8.
//
// And: investigate whether B/C alone can be both "type + partner-idx".
// B ∈ {0,1,2,4} — only 4 distinct, too small for a partner-idx.
// C ∈ {0,1,2,3,4} — 5 distinct, too small.
//
// Re-test: across save_10_fresh (T0 — initial diplomacy), what does the
// A distribution look like? At T0, there should be ~descr_strat-config
// relationships. count = 292 entries across 23 majors. If RIS imperial
// has ~292 starting major-major relations declared in faction_relationships
// + core_attitudes, A might be a stable per-pair UUID assigned at world
// creation.
//
// Usage: node dig-diplo-G2.js
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "fixtures", "feral");

function readMajor(b) {
  const out = [];
  for (let i = 0; i + 64 < b.length; i += 1) {
    if (b.readUInt32LE(i + 8) !== 100) continue;
    if (b.readUInt32LE(i + 12) !== 1) continue;
    if (b.readUInt32LE(i + 16) !== 0 || b.readUInt32LE(i + 20) !== 0) continue;
    if (b.readUInt32LE(i + 24) !== i + 24) continue;
    if (b.readUInt32LE(i + 32) !== 0 || b.readUInt32LE(i + 36) !== 0) continue;
    if (b.readUInt32LE(i + 40) !== i + 40) continue;
    if (b.readUInt32LE(i + 44) !== 6) continue;
    const regions = b.readUInt32LE(i + 48);
    if (regions > 200) continue;
    out.push({ pos: i, regions });
  }
  return out;
}

function getEntries(buf, m) {
  const markerOff = m.pos + 244 + 4 * m.regions;
  if (buf[markerOff] !== 0x05 || buf[markerOff + 1] !== 0x00 || buf[markerOff + 2] !== 0x24 || buf[markerOff + 3] !== 0x39) return [];
  const count = buf.readUInt32LE(markerOff + 4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = markerOff + 8 + i * 16;
    const A = buf.readUInt32LE(off);
    const B = buf.readUInt32LE(off + 4);
    const C = buf.readUInt32LE(off + 8);
    const D = buf.readUInt32LE(off + 12);
    out.push({
      A, B, C, D,
      // re-parse A as splits
      Aa: A & 0xff,
      Ab: (A >> 8) & 0xff,
      Ac: (A >> 16) & 0xff,
      Ad: (A >> 24) & 0xff,
      // re-parse A as 2× u16
      Alo: A & 0xffff,
      Ahi: (A >> 16) & 0xffff,
      // D split
      Da: D & 0xff,
      Db: (D >> 8) & 0xff,
      Dc: (D >> 16) & 0xff,
      Dd: (D >> 24) & 0xff,
      ownerMajor: undefined,
      pos: off,
    });
  }
  return out;
}

const saves = ["save_10_fresh.sav", "ror_t1e.sav", "ror_t5.sav", "ror_t11s.sav", "athens_t21.sav", "athens_t22e.sav", "save_1.2.sav"];
const data = saves.map((f) => {
  const buf = fs.readFileSync(path.join(root, f));
  return { name: f, buf, majors: readMajor(buf) };
});

// === Step 1: parse-A-as-2u16 distribution ===
// Per save, look at Ahi (high u16 of A) — is it small (< 256, < 23)?
// And Alo — what does its distribution look like?
console.log("=== A re-parsed as <u16 lo><u16 hi> (per save) ===");
for (const d of data) {
  const allA = [];
  for (const m of d.majors) allA.push(...getEntries(d.buf, m));
  if (allA.length === 0) continue;
  const distAhi = new Set(allA.map((e) => e.Ahi));
  const distAlo = new Set(allA.map((e) => e.Alo));
  const maxAhi = Math.max(...allA.map((e) => e.Ahi));
  const maxAlo = Math.max(...allA.map((e) => e.Alo));
  const minAhi = Math.min(...allA.map((e) => e.Ahi));
  const minAlo = Math.min(...allA.map((e) => e.Alo));
  console.log(`  ${d.name}: n=${allA.length}  Ahi distinct=${distAhi.size} range=${minAhi}..${maxAhi}  Alo distinct=${distAlo.size} range=${minAlo}..${maxAlo}`);
}

// === Step 2: full A-bytes distribution for save_10_fresh (T0) ===
const fresh = data.find((d) => d.name === "save_10_fresh.sav");
const allFresh = [];
for (let mi = 0; mi < fresh.majors.length; mi++) {
  for (const e of getEntries(fresh.buf, fresh.majors[mi])) allFresh.push({ ...e, ownerMajor: mi });
}
console.log(`\nsave_10_fresh total entries: ${allFresh.length}`);

// byte-0 of A distribution
const aByte0 = {};
allFresh.forEach((e) => { aByte0[e.Aa] = (aByte0[e.Aa] || 0) + 1; });
console.log("\n=== A byte-0 (low) distribution in save_10_fresh ===");
const aByte0Sorted = Object.entries(aByte0).sort((a, b) => +a[0] - +b[0]);
console.log(`  distinct values: ${aByte0Sorted.length}`);
aByte0Sorted.slice(0, 30).forEach(([k, v]) => console.log(`  byte0=${k}: count=${v}`));

// === Step 3: complete dump of save_10_fresh entries per owner-major, ordered ===
console.log("\n=== save_10_fresh per-major full entries ===");
for (let mi = 0; mi < fresh.majors.length; mi++) {
  const entries = getEntries(fresh.buf, fresh.majors[mi]);
  console.log(`\n  major[${mi}] (regions=${fresh.majors[mi].regions}, count=${entries.length}):`);
  entries.forEach((e, i) => {
    console.log(`    [${i.toString().padStart(3)}] A=${e.A.toString().padStart(6)} (Alo=${e.Alo.toString().padStart(5)}, Ahi=${e.Ahi.toString().padStart(3)}) B=${e.B} C=${e.C} D=0x${e.D.toString(16).padStart(8, "0")}`);
  });
}

// === Step 4: across all 23 majors in fresh, is the SEQUENCE of A values
// monotonic? If so, the engine assigns relation-UUIDs in a global counter.
console.log("\n=== save_10_fresh: A values in file order (all majors) ===");
const aSeq = [];
for (let mi = 0; mi < fresh.majors.length; mi++) {
  for (const e of getEntries(fresh.buf, fresh.majors[mi])) aSeq.push({ A: e.A, ownerMajor: mi });
}
// Show first 40 and check whether monotonic
let monotonic = true;
for (let i = 1; i < aSeq.length; i++) {
  if (aSeq[i].A < aSeq[i - 1].A) { monotonic = false; break; }
}
console.log(`  monotonic across all owners: ${monotonic}`);
console.log(`  first 30: ${aSeq.slice(0, 30).map((x) => `m${x.ownerMajor}:${x.A}`).join("  ")}`);
console.log(`  last 30: ${aSeq.slice(-30).map((x) => `m${x.ownerMajor}:${x.A}`).join("  ")}`);

// === Step 5: examine D (the 4-byte tag) — is it really `01 01 01 00` everywhere?
console.log("\n=== D field distribution across save_10_fresh ===");
const dHisto = {};
allFresh.forEach((e) => { dHisto[e.D.toString(16).padStart(8, "0")] = (dHisto[e.D.toString(16).padStart(8, "0")] || 0) + 1; });
Object.entries(dHisto).forEach(([k, v]) => console.log(`  D=0x${k}  count=${v}`));
