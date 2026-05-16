// dig-diplo-E.js — session 108 step E
//
// Validate the `05 00 24 39 <u32 count> <count × 16-byte entries>` zone
// across all saves. Key questions:
//   * Does the count grow monotonically over turns?
//   * Are entries APPENDED (oldest first) or PREPENDED (newest first)?
//   * Is the entries' B/C value pattern consistent across saves?
//   * Cross-validate: compute total entries across all 23 majors per save.
//     If it equals number of game-events, that's diplomatic events log.
//
// Then: do a clean diff of major[0] entries between save_10_fresh (T0) and
// ror_t1e (T1 end) — what entries got added in 1 turn?
//
// Usage: node dig-diplo-E.js
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
  if (buf[markerOff] !== 0x05 || buf[markerOff + 1] !== 0x00 || buf[markerOff + 2] !== 0x24 || buf[markerOff + 3] !== 0x39) {
    return { count: -1, entries: [] };
  }
  const count = buf.readUInt32LE(markerOff + 4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = markerOff + 8 + i * 16;
    entries.push({
      A: buf.readUInt32LE(off),
      B: buf.readUInt32LE(off + 4),
      C: buf.readUInt32LE(off + 8),
      D: buf.readUInt32LE(off + 12),
    });
  }
  return { count, entries, markerOff };
}

const SAVES = [
  "save_10_fresh.sav",
  "ror_t1e.sav",
  "ror_t2s.sav",
  "ror_t5.sav",
  "ror_t11s.sav",
  "ror_t11e.sav",
  "athens_t21.sav",
  "athens_t22e.sav",
  "save_mp_before.sav",
  "save_mp_after.sav",
];

const data = SAVES.map((f) => {
  const buf = fs.readFileSync(path.join(root, f));
  return { name: f, buf, majors: readMajor(buf) };
});

console.log("Per-save total entries across all majors:");
console.log("save                | total entries | per-major counts");
for (const d of data) {
  const total = d.majors.reduce((s, m) => s + Math.max(0, getEntries(d.buf, m).count), 0);
  const cs = d.majors.map((m) => getEntries(d.buf, m).count);
  console.log(`  ${d.name.padEnd(20)} | ${total.toString().padStart(5)} | [${cs.join(",")}]`);
}

// Diff: save_mp_before vs save_mp_after — should be byte-identical for this zone
console.log("\n=== save_mp_before vs save_mp_after — entry-zone diff ===");
const mpB = data.find((d) => d.name === "save_mp_before.sav");
const mpA = data.find((d) => d.name === "save_mp_after.sav");
for (let k = 0; k < mpB.majors.length; k++) {
  const eB = getEntries(mpB.buf, mpB.majors[k]);
  const eA = getEntries(mpA.buf, mpA.majors[k]);
  if (eB.count !== eA.count) {
    console.log(`  major[${k}] differs in count: ${eB.count} -> ${eA.count}`);
  } else {
    // Compare entries
    let diffCount = 0;
    for (let i = 0; i < eB.count; i++) {
      if (eB.entries[i].A !== eA.entries[i].A || eB.entries[i].B !== eA.entries[i].B ||
          eB.entries[i].C !== eA.entries[i].C || eB.entries[i].D !== eA.entries[i].D) diffCount++;
    }
    if (diffCount > 0) {
      console.log(`  major[${k}] count=${eB.count} byte-diffs=${diffCount}`);
    }
  }
}
console.log("(no output above = save_mp pair is byte-identical in this zone)");

// Diff: ror_t11s vs ror_t11e (same turn) — should also be near-identical
console.log("\n=== ror_t11s vs ror_t11e — entry-zone diff ===");
const t11s = data.find((d) => d.name === "ror_t11s.sav");
const t11e = data.find((d) => d.name === "ror_t11e.sav");
for (let k = 0; k < t11s.majors.length; k++) {
  const eS = getEntries(t11s.buf, t11s.majors[k]);
  const eE = getEntries(t11e.buf, t11e.majors[k]);
  if (eS.count !== eE.count) {
    console.log(`  major[${k}] count differs: t11s=${eS.count} -> t11e=${eE.count}`);
  } else {
    let diffCount = 0;
    for (let i = 0; i < eS.count; i++) {
      if (eS.entries[i].A !== eE.entries[i].A || eS.entries[i].B !== eE.entries[i].B ||
          eS.entries[i].C !== eE.entries[i].C) diffCount++;
    }
    if (diffCount > 0) console.log(`  major[${k}] count=${eS.count} entries differ in ${diffCount} positions`);
  }
}

// Diff: save_10_fresh major[0] vs ror_t1e major[0] entries — show added/removed
console.log("\n=== save_10_fresh major[0] (T0) vs ror_t1e major[0] (T1 end) ===");
const fresh = data.find((d) => d.name === "save_10_fresh.sav");
const t1 = data.find((d) => d.name === "ror_t1e.sav");
const e0F = getEntries(fresh.buf, fresh.majors[0]);
const e0T = getEntries(t1.buf, t1.majors[0]);
console.log(`  count: T0=${e0F.count}  T1=${e0T.count}`);
console.log(`  T0 entries:`);
e0F.entries.forEach((e) => console.log(`    A=${e.A} B=${e.B} C=${e.C}`));
console.log(`  T1 entries:`);
e0T.entries.forEach((e) => console.log(`    A=${e.A} B=${e.B} C=${e.C}`));

// Per-save count for major[2] (Carthaginians or similar — has many entries)
console.log("\n=== major[2] count over time ===");
for (const d of data) {
  const e = getEntries(d.buf, d.majors[2]);
  console.log(`  ${d.name.padEnd(20)}: count=${e.count}`);
}

// Count grow profile across all majors and saves
console.log("\n=== Sum of counts across all majors per save ===");
const summary = data.map((d) => ({
  name: d.name,
  total: d.majors.reduce((s, m) => s + Math.max(0, getEntries(d.buf, m).count), 0),
}));
summary.forEach((s) => console.log(`  ${s.name.padEnd(20)}: ${s.total}`));
