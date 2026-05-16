// dig-diplo-J.js — session 109 step J
//
// Diff save_10_fresh (T0) vs save_1.2 (mid-campaign)
//   * which A values changed in B and/or C?
//   * are there NEW A values added? OLD ones removed?
//   * for changed entries, what's the B/C transition pattern?
//
// Also compare save_10_fresh vs ror_t5 (T5) to look at longer-term changes.
//
// This helps figure out enum semantics by observing what transitions
// happen over time (e.g., war-declarations should be B=0→B=2, peace-
// agreements should be B=2→B=0).
//
// Usage: node dig-diplo-J.js
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "fixtures", "feral");

function findValidMarkers(buf) {
  const markers = [];
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0x05 && buf[i + 1] === 0x00 && buf[i + 2] === 0x24 && buf[i + 3] === 0x39) markers.push(i);
  }
  return markers.filter((off) => {
    const count = buf.readUInt32LE(off + 4);
    if (count > 200 || count === 0) return false;
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      if (e + 16 > buf.length) return false;
      if (buf[e + 12] !== 0x01 || buf[e + 13] !== 0x01 || buf[e + 14] !== 0x01 || buf[e + 15] !== 0x00) return false;
    }
    return true;
  });
}

function collectMap(buf) {
  const valid = findValidMarkers(buf);
  const map = new Map();
  for (let zi = 0; zi < valid.length; zi++) {
    const off = valid[zi];
    const count = buf.readUInt32LE(off + 4);
    for (let k = 0; k < count; k++) {
      const e = off + 8 + k * 16;
      const A = buf.readUInt32LE(e);
      map.set(A, { zone: zi, markerOff: off, A,
        B: buf.readUInt32LE(e + 4),
        C: buf.readUInt32LE(e + 8),
        D: buf.readUInt32LE(e + 12)
      });
    }
  }
  return map;
}

function dumpDiff(a, b, labelA, labelB) {
  const aKeys = new Set(a.keys());
  const bKeys = new Set(b.keys());
  const onlyA = [...aKeys].filter((k) => !bKeys.has(k));
  const onlyB = [...bKeys].filter((k) => !aKeys.has(k));
  const common = [...aKeys].filter((k) => bKeys.has(k));
  const changes = [];
  for (const k of common) {
    const x = a.get(k), y = b.get(k);
    if (x.B !== y.B || x.C !== y.C) {
      changes.push({ A: k, before: { B: x.B, C: x.C }, after: { B: y.B, C: y.C } });
    }
  }
  console.log(`\n=== ${labelA} → ${labelB} ===`);
  console.log(`  total ${labelA}: ${a.size}, total ${labelB}: ${b.size}`);
  console.log(`  removed (only in ${labelA}): ${onlyA.length}`);
  console.log(`  added (only in ${labelB}): ${onlyB.length}`);
  console.log(`  common entries: ${common.length}`);
  console.log(`  changed entries: ${changes.length}`);

  // B-transition matrix
  const bTrans = {};
  for (const c of changes) {
    const k = `B${c.before.B}→B${c.after.B}`;
    bTrans[k] = (bTrans[k] || 0) + 1;
  }
  console.log(`  B-transition matrix:`);
  Object.entries(bTrans).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  // C-transition matrix
  const cTrans = {};
  for (const c of changes) {
    const k = `C${c.before.C}→C${c.after.C}`;
    cTrans[k] = (cTrans[k] || 0) + 1;
  }
  console.log(`  C-transition matrix:`);
  Object.entries(cTrans).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${k}: ${v}`));

  // Sample new entries
  console.log(`  sample NEW entries (B/C distribution of additions):`);
  const newBC = {};
  for (const k of onlyB) {
    const y = b.get(k);
    const key = `B${y.B},C${y.C}`;
    newBC[key] = (newBC[key] || 0) + 1;
  }
  Object.entries(newBC).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log(`    ${k}: ${v}`));
}

const fresh = collectMap(fs.readFileSync(path.join(root, "save_10_fresh.sav")));
const t1e = collectMap(fs.readFileSync(path.join(root, "ror_t1e.sav")));
const t5 = collectMap(fs.readFileSync(path.join(root, "ror_t5.sav")));
const t11 = collectMap(fs.readFileSync(path.join(root, "ror_t11e.sav")));
const t21 = collectMap(fs.readFileSync(path.join(root, "athens_t21.sav")));
const t22e = collectMap(fs.readFileSync(path.join(root, "athens_t22e.sav")));
const s12 = collectMap(fs.readFileSync(path.join(root, "save_1.2.sav")));
const mpb = collectMap(fs.readFileSync(path.join(root, "save_mp_before.sav")));
const mpa = collectMap(fs.readFileSync(path.join(root, "save_mp_after.sav")));

dumpDiff(fresh, t1e, "save_10_fresh", "ror_t1e (T1 end)");
dumpDiff(t1e, t5, "ror_t1e", "ror_t5 (T5)");
dumpDiff(t5, t11, "ror_t5", "ror_t11e (T11 end)");
dumpDiff(t11, t21, "ror_t11e", "athens_t21 (T21 different campaign)");
dumpDiff(t21, t22e, "athens_t21", "athens_t22e");
dumpDiff(fresh, s12, "save_10_fresh", "save_1.2");
dumpDiff(mpb, mpa, "save_mp_before", "save_mp_after");

// Now examine what B-C combinations occur in T0
console.log(`\n=== save_10_fresh: B-C joint distribution ===`);
const bc = {};
for (const e of fresh.values()) {
  const key = `B=${e.B},C=${e.C}`;
  bc[key] = (bc[key] || 0) + 1;
}
Object.entries(bc).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// In athens_t22e — what's the B-C distribution?
console.log(`\n=== athens_t22e (player=athens, T22 end): B-C joint distribution ===`);
const bc22 = {};
for (const e of t22e.values()) {
  const key = `B=${e.B},C=${e.C}`;
  bc22[key] = (bc22[key] || 0) + 1;
}
Object.entries(bc22).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
