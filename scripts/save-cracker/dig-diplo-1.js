// dig-diplo-1.js — session 108 step 1
//
// Goal: characterize the 239 ff0aaff0 faction records. The player record is
// huge (~334 KB) but the other 238 are small (~6 KB). What's the size
// distribution? Where are the boundaries? Inside an NPC record, what is the
// header layout vs the body?
//
// Usage: node dig-diplo-1.js
"use strict";

const fs = require("fs");
const path = require("path");
const { findFactionRecords } = require("../../src/factionRecordParser");

const SAVES = [
  "save_10_fresh.sav",
  "save_1.2.sav",
  "ror_t1e.sav",
  "ror_t5.sav",
  "ror_t11s.sav",
  "athens_t21.sav",
];

const root = path.join(__dirname, "fixtures", "feral");

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function hist(arr, bins) {
  const out = new Array(bins.length).fill(0);
  for (const v of arr) {
    let placed = false;
    for (let b = 0; b < bins.length; b++) {
      if (v <= bins[b]) { out[b] += 1; placed = true; break; }
    }
    if (!placed) out[bins.length - 1] += 1;
  }
  return out;
}

function summarize(label, recs) {
  const sizes = recs.map((r) => r.size);
  const mn = Math.min(...sizes);
  const mx = Math.max(...sizes);
  const med = median(sizes);
  const bins = [1024, 2048, 4096, 6144, 8192, 16384, 65536, 1 << 20];
  const h = hist(sizes, bins);
  console.log(`\n=== ${label}: ${recs.length} records ===`);
  console.log(`  size min=${mn}  median=${med}  max=${mx}`);
  console.log(`  span: 0x${recs[0].offset.toString(16)} .. 0x${(recs.at(-1).offset + recs.at(-1).size).toString(16)}`);
  const labels = bins.map((b, i) => i === 0 ? `≤${b}` : `≤${b}`);
  for (let i = 0; i < bins.length; i++) {
    console.log(`  ${labels[i].padStart(7)} : ${h[i]}`);
  }
  // Player record candidate (the one >100 KB)
  const huge = recs.filter((r) => r.size > 100000);
  if (huge.length) {
    console.log(`  >100 KB records: ${huge.length} (the player)`);
    huge.forEach((h, i) => console.log(`    [${recs.indexOf(h)}] at 0x${h.offset.toString(16)}, ${h.size} B`));
  }
}

function inspectFirstFewNpcRecords(buf, recs, label) {
  // Find first ~6KB NPC record (not the player).
  const npc = recs.filter((r) => r.size > 1024 && r.size < 12000);
  if (!npc.length) { console.log(`\n${label}: no NPC-like records found`); return; }
  console.log(`\n${label}: ${npc.length} NPC-class records (1-12 KB)`);
  // Dump byte content past the magic header (first 64 bytes hex) for first 3.
  for (let k = 0; k < Math.min(3, npc.length); k++) {
    const r = npc[k];
    const idx = recs.indexOf(r);
    console.log(`\n  NPC[${k}] idx=${idx} pos=0x${r.offset.toString(16)} size=${r.size}`);
    // Header 24 bytes per factionRecordParser docs:
    //   +0..3 magic1, +4..7 selfPtr, +8..11 selfPtr+4, +12..15 magic2,
    //   +16..19 = 0x3FC (1020), +20..23 = 0x2BC (700)
    const m1 = buf.readUInt32LE(r.offset + 0).toString(16);
    const sp = buf.readUInt32LE(r.offset + 4);
    const sp4 = buf.readUInt32LE(r.offset + 8);
    const m2 = buf.readUInt32LE(r.offset + 12).toString(16);
    const c1 = buf.readUInt32LE(r.offset + 16);
    const c2 = buf.readUInt32LE(r.offset + 20);
    console.log(`    +0 m1=${m1}  +4 sp=${sp} (exp ${r.offset + 4})  +8 sp+4=${sp4}  +12 m2=${m2}  +16=${c1}  +20=${c2}`);
    // Hex dump bytes 24..120 (the post-header area)
    const slice = buf.slice(r.offset + 24, r.offset + 24 + 96);
    let line = "    +24..+119:";
    for (let i = 0; i < slice.length; i++) {
      if (i % 16 === 0) line += "\n      ";
      line += slice[i].toString(16).padStart(2, "0") + " ";
    }
    console.log(line);
  }
}

function main() {
  for (const f of SAVES) {
    const fp = path.join(root, f);
    if (!fs.existsSync(fp)) { console.log(`skip ${f}`); continue; }
    const buf = fs.readFileSync(fp);
    const recs = findFactionRecords(buf);
    summarize(f, recs);
    if (f === "save_1.2.sav" || f === "save_10_fresh.sav") {
      inspectFirstFewNpcRecords(buf, recs, f);
    }
  }
}

main();
