// dig-watchtower-final.js — finalize the watchtower-count cracking.
//
// Confirmed: the post-anchor 40-byte stride table starting at 0x1875cbd
// (T1017) is the EXACT WATCHTOWER POOL. Each record:
//   +0  u32  tile_x
//   +4  u32  tile_y
//   +8  u32  ?
//   +12 u32  ?
//   +16..23  8B  random-looking (per-instance ID / hash?)
//   +24..27  u32  zero (always)
//   +28..31  '61 13 82 12'  magic (CONSTANT across every record)
//   +32..35  '61 13 82 12'  magic (constant except LAST record has terminator)
//   +36..39  random tail
//
// The LAST record's +32 field swaps to '2c 71 21 ad' which is the same
// 4-byte terminator that appears in the table HEADER preceding the array.
//
// Counts found:
//   T960:  156 watchtowers (156 stride-40 records from anchor to terminator)
//   T1017: 176 watchtowers
//   T1018: 177 watchtowers   ← grew by 1 (1 watchtower built between turns)
//
// The signature for a watchtower record is:
//   bytes[+28..+31] === [0x61, 0x13, 0x82, 0x12]
//   AND record is at stride 40 from a previous "watchtower record" or
//   from the table anchor.
//
// We can robustly detect the table by:
//   (1) scanning for the unique 40-byte-spaced sequence of '61 13 82 12'
//       repeats at +28
//   (2) walking forward by 40-byte stride
//   (3) stopping when bytes +28..+31 of the next record do NOT match the magic
//       (the terminator '2c 71 21 ad' at +32 of the last record marks the end)
//
// This script:
//   * locates the watchtower table by scanning the SETT-zone region for the
//     stride-40 magic pattern
//   * walks and counts records
//   * dumps validation info

"use strict";
const fs = require("fs");

const SAVES = [
  ["t960-start",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1017",          "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

// Watchtower record magic at byte +28 (constant across all WT records)
const WT_MAGIC = Buffer.from([0x61, 0x13, 0x82, 0x12]);

// Find the watchtower table: scan for a 40-byte stride sequence of WT_MAGIC at
// the +28 offset. Robust validation: require ≥3 consecutive strides matching.
function findWatchtowerTable(buf) {
  // Scan within a generous range. From observations, the table sits in the
  // SETT-zone region at ~0x1875cbd (varies per save). Range below covers it
  // comfortably.
  const SCAN_START = 0x1000000;
  const SCAN_END = Math.min(buf.length, 0x2000000);

  let p = SCAN_START;
  while (p + 40 * 3 <= SCAN_END) {
    const at = buf.indexOf(WT_MAGIC, p);
    if (at < 0 || at >= SCAN_END) return null;
    // Candidate: this is at +28 of record, so record start = at - 28
    const recStart = at - 28;
    if (recStart < SCAN_START) { p = at + 1; continue; }
    // Validate: next 3 records all have magic at +28
    let valid = true;
    for (let k = 1; k <= 3; k++) {
      const nxt = recStart + k * 40 + 28;
      if (nxt + 4 > buf.length) { valid = false; break; }
      if (buf.compare(WT_MAGIC, 0, 4, nxt, nxt + 4) !== 0) {
        // Allow the LAST record to differ (table end), but require at least
        // 3 consecutive matches.
        valid = false;
        break;
      }
    }
    if (valid) return recStart;
    p = at + 1;
  }
  return null;
}

// Walk the table forward by 40-byte stride, counting records.
// Each watchtower record has the magic '61 13 82 12' at +28.
function countWatchtowers(buf) {
  const start = findWatchtowerTable(buf);
  if (start === null) return null;
  let p = start, count = 0;
  while (p + 40 <= buf.length) {
    // Validate: +28..+31 must be WT_MAGIC
    if (buf.compare(WT_MAGIC, 0, 4, p + 28, p + 32) !== 0) break;
    // Coord sanity: u32 at +0/+4 must be small (< 4096; typical RTW map < 1024)
    const x = buf.readUInt32LE(p);
    const y = buf.readUInt32LE(p + 4);
    if (x >= 4096 || y >= 4096) break;
    count++;
    p += 40;
  }
  return { start, count, end: p };
}

for (const [tag, savePath] of SAVES) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n========= ${tag} =========`);
  const r = countWatchtowers(buf);
  if (!r) { console.log("  watchtower table not found"); continue; }
  console.log(`  watchtower table @ 0x${r.start.toString(16)}..0x${r.end.toString(16)}`);
  console.log(`  COUNT: ${r.count}`);

  // Verify all 22 descr_strat starting watchtowers are present.
  const DS = "C:/dev/Provincia/bundled-mod/data/world/maps/campaign/imperial_campaign/descr_strat.txt";
  const dsLines = fs.readFileSync(DS, "utf8").split(/\r?\n/);
  const wtCoords = [];
  for (const line of dsLines) {
    const m = line.match(/^watchtower\s+(\d+)[\s,]+(\d+)/);
    if (m) wtCoords.push({ x: parseInt(m[1]), y: parseInt(m[2]) });
  }
  const tableCoords = new Set();
  for (let p = r.start; p < r.end; p += 40) {
    const x = buf.readUInt32LE(p);
    const y = buf.readUInt32LE(p + 4);
    tableCoords.add(`${x},${y}`);
  }
  let found = 0;
  for (const c of wtCoords) if (tableCoords.has(`${c.x},${c.y}`)) found++;
  console.log(`  validation: ${found}/${wtCoords.length} descr_strat starting watchtowers present in table`);

  // Show distribution of byte +13 (likely faction id — values 0..4 in t960 ⇒
  // 5 factions placing watchtowers? RTW has way more)
  const v13 = {};
  for (let p = r.start; p < r.end; p += 40) {
    const v = buf[p + 13];
    v13[v] = (v13[v] || 0) + 1;
  }
  console.log(`  +13 (high byte of u32@+12) distribution: ${Object.entries(v13).sort((a,b)=>b[1]-a[1]).map(([v,n])=>`0x${(+v).toString(16)}=${n}`).join(", ")}`);
}
