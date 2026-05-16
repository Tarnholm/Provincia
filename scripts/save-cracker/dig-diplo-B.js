// dig-diplo-B.js — session 108 step B
//
// Hypothesis pivot: the section starting with `05 00 24 39 <u32 count>` at
// approximately +316 of each major-faction record is NOT the diplomatic
// relations table but is the per-faction EVENT/HISTORY log — like the
// player's HEAD building-records but for major-AI factions.
//
// Look:
//   * major[1] count=34 (small)
//   * major[3] count=115 (lots of activity)
//   * major[5,6,9,10,13,19,21] count=0 (factions that had no events)
//
// These are turn-event logs per faction (similar to player HEAD records),
// NOT (factionA, factionB) → state diplomacy. So this is the wrong target.
//
// Re-pivot: the FOUR-byte field at +29..+30..+31 (i.e., +28 u32) might be
// the RNG state for this faction — every faction has its own RNG state.
//
// Let me look at the REGION JUST BEFORE the `05 00 24 39` marker. That
// area contains likely a diplomatic-status struct.
//
// For each major record, find the offset of `05 00 24 39` (uniformly across
// all saves), then look at the 64 bytes BEFORE it. That zone is the
// candidate diplomacy zone.
//
// Usage: node dig-diplo-B.js
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

const fresh = fs.readFileSync(path.join(root, "save_10_fresh.sav"));
const s12 = fs.readFileSync(path.join(root, "save_1.2.sav"));
const t1 = fs.readFileSync(path.join(root, "ror_t1e.sav"));
const t5 = fs.readFileSync(path.join(root, "ror_t5.sav"));
const t11s = fs.readFileSync(path.join(root, "ror_t11s.sav"));
const t11e = fs.readFileSync(path.join(root, "ror_t11e.sav"));
const a21 = fs.readFileSync(path.join(root, "athens_t21.sav"));

const SAVES = { fresh, s12, t1, t5, t11s, t11e, a21 };
const majors = {};
for (const [k, b] of Object.entries(SAVES)) majors[k] = readMajor(b);

const MARKER = Buffer.from([0x05, 0x00, 0x24, 0x39]);

function findMarker(b, start, end) {
  // Find first occurrence of MARKER in [start, end)
  for (let i = start; i + 4 <= end; i++) {
    if (b[i] === 0x05 && b[i + 1] === 0x00 && b[i + 2] === 0x24 && b[i + 3] === 0x39) return i;
  }
  return -1;
}

console.log("Marker `05 00 24 39` offsets within each major record:\n");
console.log("idx | save | majorPos | markerRel | count(u32 after marker) | regions");
for (let k = 0; k < 23; k++) {
  for (const sk of Object.keys(SAVES)) {
    const m = majors[sk];
    if (k >= m.length) continue;
    const start = m[k].pos;
    const end = k + 1 < m.length ? m[k + 1].pos : SAVES[sk].length;
    const idx = findMarker(SAVES[sk], start, end);
    if (idx < 0) continue;
    const rel = idx - start;
    const count = idx + 4 + 4 <= end ? SAVES[sk].readUInt32LE(idx + 4) : -1;
    console.log(`  ${k.toString().padStart(2)} | ${sk.padEnd(7)} | 0x${start.toString(16)} | +${rel} | ${count.toString().padStart(5)} | ${m[k].regions}`);
  }
  console.log("");
}
