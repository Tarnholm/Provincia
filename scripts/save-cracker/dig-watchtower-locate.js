// dig-watchtower-locate.js — probe the 0x2afxx hits where u32=363 appears
//
// The dev image lists watchtowers = 363. A scan for u32=363 (0x6b010000) hit at
// 0x2afb5, 0x2afc1, 0x2afcd, 0x2afd9, ... at stride 12 — looks like an array.
// That zone overlaps the diplo-event-log (0x2a25d..0x2d4a9), which session 57
// already decoded as a 12-byte-record stream. Maybe a sub-block here is the
// watchtower table?
//
// Hypothesis: the 0x6b 01 00 00 (=363) pattern is a u32 field in some
// 12-byte record (or 24-byte record) — count the rows that match.
"use strict";
const fs = require("fs");

const SAVES = [
  ["item_limit_bug", "C:/Users/vtarn/Downloads/save_item limit bug.sav"],
  ["t960",           "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 960 Start.sav"],
  ["t1018",          "C:/Users/vtarn/Downloads/save_Autosave   Dummies   Turn 1018 Start.sav"],
];

for (const [tag, path] of SAVES) {
  const buf = fs.readFileSync(path);
  console.log(`\n=== ${tag} (${path}) ===`);
  // Look at 0x2afb5..0x2b100 hex dump
  let hits = [];
  let p = 0;
  const tb = Buffer.alloc(4); tb.writeUInt32LE(363);
  while ((p = buf.indexOf(tb, p)) >= 0) { hits.push(p); p += 1; }
  console.log(`  Total u32=363 hits: ${hits.length}`);
  // Find longest run of stride-12 entries
  let longestStart = -1, longestLen = 0;
  let curStart = 0, curLen = 1;
  for (let i = 1; i < hits.length; i++) {
    if (hits[i] - hits[i-1] === 12) {
      curLen++;
    } else {
      if (curLen > longestLen) { longestLen = curLen; longestStart = curStart; }
      curStart = i; curLen = 1;
    }
  }
  if (curLen > longestLen) { longestLen = curLen; longestStart = curStart; }
  console.log(`  Longest stride-12 run of u32=363: ${longestLen} starting at idx ${longestStart} (offset 0x${hits[longestStart]?.toString(16)})`);
  // Look at a stride-12 record near 0x2afb5
  const start = 0x2afb0;
  console.log(`  Bytes 0x${start.toString(16)}..0x${(start+96).toString(16)}:`);
  for (let off = start; off < start + 96; off += 12) {
    const slice = buf.slice(off, off+12);
    console.log(`    0x${off.toString(16)}: ${slice.toString("hex").match(/.{2}/g).join(" ")}`);
  }
}
