// scripts/probe-unit-fields.js — dump raw unit-record header bytes for cracking.
//
// Reuses findUnitRecords() to locate units, then dumps a window of bytes from
// the region terminator onward so we can map unknown UNIT-LEVEL header fields.
//
// Usage:
//   node scripts/probe-unit-fields.js <save.sav> [--name <substr>] [--region <substr>]
//                                      [--window 96] [--limit 40]

"use strict";
const fs = require("fs");
const { findUnitRecords } = require("../src/unitParser.js");

function parseArgs(argv) {
  const a = { save: null, name: null, region: null, window: 96, limit: 40, pre: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") a.name = argv[++i].toLowerCase();
    else if (argv[i] === "--region") a.region = argv[++i].toLowerCase();
    else if (argv[i] === "--window") a.window = parseInt(argv[++i], 10);
    else if (argv[i] === "--limit") a.limit = parseInt(argv[++i], 10);
    else if (argv[i] === "--pre") a.pre = parseInt(argv[++i], 10);
    else if (!a.save) a.save = argv[i];
  }
  return a;
}

function hexdump(buf, base, len) {
  const lines = [];
  for (let off = 0; off < len; off += 16) {
    const row = [];
    const asc = [];
    for (let j = 0; j < 16 && off + j < len; j++) {
      const b = buf[base + off + j];
      row.push(b.toString(16).padStart(2, "0"));
      asc.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".");
    }
    lines.push(`  +${String(off).padStart(3)}  ${row.join(" ").padEnd(48)}  ${asc.join("")}`);
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const buf = fs.readFileSync(args.save);
  const recs = findUnitRecords(buf);
  let shown = 0;
  for (const r of recs) {
    if (args.name && !r.name.toLowerCase().includes(args.name)) continue;
    if (args.region && !(r.region || "").toLowerCase().includes(args.region)) continue;
    // Recompute regionEnd: the parser sets i=regionEnd at end, but we stored offset (start).
    // Re-derive by re-scanning from this record's name. Easiest: dump from offset.
    console.log(`\n=== ${r.name} @${r.offset} regionEnd=${r._regionEnd} region=${r.region} soldiers=${r.soldiers}/${r.maxSoldiers} cmd=${r.commanderUuid} xp=${r.xp} mp=${r.movementPoints} ===`);
    console.log("(window anchored at _regionEnd; +0 = post-region terminator)");
    console.log(hexdump(buf, r._regionEnd, args.window));
    if (args.pre) {
      const pre = Math.min(args.pre, r.offset);
      console.log(`--- ${pre} bytes BEFORE name (offset ${r.offset - pre}..${r.offset}) ---`);
      console.log(hexdump(buf, r.offset - pre, pre));
    }
    if (++shown >= args.limit) break;
  }
  console.log(`\n(${shown} of ${recs.length} unit records shown)`);
}

main();
