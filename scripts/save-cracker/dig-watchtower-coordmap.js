// dig-watchtower-coordmap.js — given that all 22 starting watchtower coords
// exist in the save as u32 (x,y) LE pairs, find where they live and what
// structure holds them. Then count records in that structure.

"use strict";
const fs = require("fs");
const path = require("path");

const SAVES = [
  ["t960-start",     "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1017",          "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t1018-start",    "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

const DS = "C:/dev/Provincia/bundled-mod/data/world/maps/campaign/imperial_campaign/descr_strat.txt";

const dsLines = fs.readFileSync(DS, "utf8").split(/\r?\n/);
const wtCoords = [];
for (const line of dsLines) {
  const m = line.match(/^watchtower\s+(\d+)[\s,]+(\d+)/);
  if (m) wtCoords.push({ x: parseInt(m[1]), y: parseInt(m[2]) });
}
console.log(`descr_strat watchtowers: ${wtCoords.length}`);

const { findPostGridArray } = require(path.resolve(__dirname, "../../src/mapEntityParser.js"));

for (const [tag, savePath] of SAVES) {
  const buf = fs.readFileSync(savePath);
  console.log(`\n========= ${tag} =========`);

  const arr = findPostGridArray(buf);
  if (arr) console.log(`Post-grid: 0x${arr.start.toString(16)}..0x${arr.end.toString(16)} (${arr.count} recs)`);

  // For each coord, find ALL u32(x,y) hits and bucket by region.
  const buckets = {
    "HDR <0x44e2":               { lo: 0,         hi: 0x44e2 },
    "RNG 0x44e2..0x2a25d":       { lo: 0x44e2,    hi: 0x2a25d },
    "ZONEA 0x2a25d..0x846af":    { lo: 0x2a25d,   hi: 0x846af },
    "ZONEB 0x846af..0xa8beb":    { lo: 0x846af,   hi: 0xa8beb },
    "CHAR-PATHS 0xa8beb..0xf8fd2": { lo: 0xa8beb, hi: 0xf8fd2 },
    "TILE-GRID 0xf8fd2..0xf84632": { lo: 0xf8fd2, hi: 0xf84632 },
    "PRE-POSTGRID..0xf85f5c":    { lo: 0xf84632, hi: 0xf85f5c },
    "POST-GRID-AUX":             { lo: arr ? arr.start : 0, hi: arr ? arr.end : 0 },
    "SETT-ZONE..0x1f10c72":      { lo: arr ? arr.end : 0xf85f5c, hi: 0x1f10c72 },
    "AFTER-SETT":                { lo: 0x1f10c72, hi: buf.length },
  };
  const bucketCounts = {};
  const bucketHits = {}; // bucket → coord-x → [offsets]
  for (const k of Object.keys(buckets)) { bucketCounts[k] = 0; bucketHits[k] = {}; }

  const allHits = [];
  for (const c of wtCoords) {
    const needle = Buffer.alloc(8);
    needle.writeUInt32LE(c.x, 0); needle.writeUInt32LE(c.y, 4);
    let p = 0;
    const offs = [];
    while ((p = buf.indexOf(needle, p)) >= 0) {
      offs.push(p);
      p += 1;
    }
    allHits.push({ coord: c, offs });
    for (const o of offs) {
      for (const [name, { lo, hi }] of Object.entries(buckets)) {
        if (o >= lo && o < hi) {
          bucketCounts[name]++;
          if (!bucketHits[name][`${c.x},${c.y}`]) bucketHits[name][`${c.x},${c.y}`] = [];
          bucketHits[name][`${c.x},${c.y}`].push(o);
          break;
        }
      }
    }
  }
  console.log(`\nHit distribution across regions:`);
  for (const [k, n] of Object.entries(bucketCounts)) {
    if (n > 0) console.log(`  ${k}: ${n} hits, ${Object.keys(bucketHits[k]).length}/${wtCoords.length} coords`);
  }

  // Find the bucket where MOST OR ALL of the starting watchtowers appear with
  // close-to-1 hits each — that's the canonical watchtower table.
  for (const [name, hits] of Object.entries(bucketHits)) {
    const coordsCovered = Object.keys(hits).length;
    if (coordsCovered === wtCoords.length) {
      const total = Object.values(hits).reduce((s, l) => s + l.length, 0);
      console.log(`\n  ** ${name} has ALL ${wtCoords.length} starting watchtowers (${total} total hits) **`);
      // Show offsets — are they a regular stride?
      const allOffs = [];
      for (const [c, list] of Object.entries(hits)) {
        for (const o of list) allOffs.push({ o, c });
      }
      allOffs.sort((a, b) => a.o - b.o);
      console.log(`    First 5 offsets: ${allOffs.slice(0, 5).map(x => `0x${x.o.toString(16)}[${x.c}]`).join(" ")}`);
      console.log(`    Last 5 offsets: ${allOffs.slice(-5).map(x => `0x${x.o.toString(16)}[${x.c}]`).join(" ")}`);
      // Compute stride between consecutive
      const strides = [];
      for (let i = 1; i < allOffs.length; i++) strides.push(allOffs[i].o - allOffs[i-1].o);
      // Show stride distribution
      const strideHist = {};
      for (const s of strides) strideHist[s] = (strideHist[s] || 0) + 1;
      const topStrides = Object.entries(strideHist).sort((a,b)=>b[1]-a[1]).slice(0, 10);
      console.log(`    Top strides: ${topStrides.map(([s,n])=>`${s}=${n}`).join(", ")}`);
    }
  }

  // Detailed look at CHAR-PATHS and other regions
  console.log(`\n--- All-bucket detail for first 3 coords ---`);
  for (const h of allHits.slice(0, 3)) {
    console.log(`  (${h.coord.x},${h.coord.y}): ${h.offs.length} hits`);
    for (const o of h.offs) {
      let region = "?";
      for (const [name, { lo, hi }] of Object.entries(buckets)) {
        if (o >= lo && o < hi) { region = name; break; }
      }
      console.log(`    0x${o.toString(16)}  [${region}]`);
    }
  }
}
