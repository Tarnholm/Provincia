// dig-faction-trailing1.js — Per-faction trailing data, using clean save pairs
// from the calibration archive that contain controlled changes.
//
// Available pairs (Macedon Turn 1):
//   save_saveturn1start.sav (16:56) - clean turn 1 start
//   save_saveturn1building.sav (17:00) - +1 building started (vs start)
//   save_saveturn1construction.sav (17:53) - +1 building progress?
//   save_saveturn1move.sav (00:12) - +1 movement
//   save_notdamagedturn1.sav (18:17) - unit at full health
//   save_damagedturn1.sav (18:25) - unit damaged
//
// Goal: figure out what's stored in faction trailing data by diffing a save-pair
// where ONE controlled change happened.

const fs = require("fs");
const path = require("path");

const ALEX_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Alexander/saves";
const SAVE_START = path.join(ALEX_DIR, "save_saveturn1start.sav");
const SAVE_BUILDING = path.join(ALEX_DIR, "save_saveturn1building.sav");
const SAVE_CONSTRUCT = path.join(ALEX_DIR, "save_saveturn1construction.sav");
const SAVE_MOVE = path.join(ALEX_DIR, "save_saveturn1move.sav");
const SAVE_NOT_DAMAGED = path.join(ALEX_DIR, "save_notdamagedturn1.sav");
const SAVE_DAMAGED = path.join(ALEX_DIR, "save_damagedturn1.sav");
const SAVE_NOMOVE = path.join(ALEX_DIR, "save_Noarmiesmovedturn1.sav");

function bytewiseDiff(bufA, bufB) {
  // Find all byte differences between two equally-sized buffers
  const diffs = [];
  const n = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < n; i++) {
    if (bufA[i] !== bufB[i]) diffs.push(i);
  }
  return { diffs, sizeA: bufA.length, sizeB: bufB.length };
}

function clusterDiffs(diffs, gap = 16) {
  // Group adjacent diff offsets into clusters
  const clusters = [];
  let cur = null;
  for (const d of diffs) {
    if (cur === null) cur = { start: d, end: d };
    else if (d - cur.end <= gap) cur.end = d;
    else { clusters.push(cur); cur = { start: d, end: d }; }
  }
  if (cur) clusters.push(cur);
  return clusters;
}

function reportPair(a, b, labelA, labelB) {
  console.log(`\n===== ${labelA} vs ${labelB} =====`);
  const bufA = fs.readFileSync(a);
  const bufB = fs.readFileSync(b);
  console.log(`Sizes: ${bufA.length} vs ${bufB.length} (delta=${bufB.length - bufA.length})`);

  if (bufA.length !== bufB.length) {
    console.log(`Sizes differ — finding common prefix...`);
  }
  const { diffs } = bytewiseDiff(bufA, bufB);
  console.log(`Total byte diffs: ${diffs.length}`);
  const clusters = clusterDiffs(diffs);
  console.log(`Cluster count (gap=16): ${clusters.length}`);
  console.log(`Top 20 largest clusters:`);
  const sorted = [...clusters].sort((a, b) => (b.end - b.start) - (a.end - a.start));
  for (const c of sorted.slice(0, 20)) {
    const sz = c.end - c.start + 1;
    console.log(`  0x${c.start.toString(16)}..0x${c.end.toString(16)} = ${sz} bytes`);
    // Print a hex dump of both sides
    const len = Math.min(sz, 48);
    const aHex = [];
    const bHex = [];
    for (let k = 0; k < len; k++) {
      aHex.push((bufA[c.start + k] ?? 0).toString(16).padStart(2, "0"));
      bHex.push((bufB[c.start + k] ?? 0).toString(16).padStart(2, "0"));
    }
    console.log(`    A: ${aHex.join(" ")}`);
    console.log(`    B: ${bHex.join(" ")}`);
  }
  // Geography breakdown
  const zones = [
    { name: "header", a: 0, b: 0x3328 },
    { name: "HST", a: 0x3328, b: 0x3b00 },
    { name: "body-early", a: 0x3b00, b: 0x70000 },
    { name: "body-mid", a: 0x70000, b: 0xc0000 },
    { name: "body-late", a: 0xc0000, b: 0x100000 },
    { name: "tail", a: 0x100000, b: bufA.length },
  ];
  console.log(`\nDiffs by zone:`);
  for (const z of zones) {
    const inZone = diffs.filter(d => d >= z.a && d < z.b).length;
    console.log(`  ${z.name} (0x${z.a.toString(16)}..0x${z.b.toString(16)}): ${inZone} diffs`);
  }
}

// Run multiple pair comparisons
reportPair(SAVE_START, SAVE_BUILDING, "start", "building");
reportPair(SAVE_BUILDING, SAVE_CONSTRUCT, "building", "construct");
reportPair(SAVE_START, SAVE_MOVE, "start", "move");
reportPair(SAVE_NOT_DAMAGED, SAVE_DAMAGED, "notdamaged", "damaged");
