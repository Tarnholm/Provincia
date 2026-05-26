// dig-settdet-structure.js — look at per-settlement detail record structure
// to find embedded port/watchtower/road flags.
"use strict";
const fs = require("fs");
const path = require("path");
const { findAllSettlementMarkers, scanChainsBetween } = require(path.resolve("src/buildingParser.js"));

const SAVE = process.argv[2] || "C:/Users/vtarn/Downloads/save_item limit bug.sav";
const buf = fs.readFileSync(SAVE);
console.log(`save: ${SAVE} (${buf.length} B)`);

const setts = findAllSettlementMarkers(buf).filter(s => s.offset >= 0xf85f00 && s.offset < 0x1f10c72);
console.log(`settlements: ${setts.length}`);

// For each settlement, look at the detail record body. Specifically: scan for
// the string tokens "port", "watchtower", "road" near the marker, also look
// for embedded section type tags WATCHTOWER (idx 60), PORT (?), etc.

// First: do ANY settlement detail records contain ASCII "watchtower"?
let watchHit = 0, portHit = 0, roadHit = 0;
for (let i = 0; i < setts.length; i++) {
  const start = i === 0 ? 0xf85f00 : setts[i-1].blockEnd;
  const end = (i + 1 < setts.length) ? setts[i+1].offset : 0x1f10c72;
  const slice = buf.slice(start, end);
  if (slice.includes(Buffer.from("watchtower"))) watchHit++;
  if (slice.includes(Buffer.from("port_buildings"))) portHit++;
  if (slice.includes(Buffer.from("hinterland_roads"))) roadHit++;
}
console.log(`settlements with 'watchtower' string: ${watchHit}`);
console.log(`settlements with 'port_buildings' string: ${portHit}`);
console.log(`settlements with 'hinterland_roads' string: ${roadHit}`);

// Dump 1 KB around the first settlement marker
const s0 = setts[0];
console.log(`\nFirst settlement: name='${s0.name}' at 0x${s0.offset.toString(16)}, blockEnd=0x${s0.blockEnd.toString(16)}`);
const ds = s0.blockEnd, de = Math.min(ds + 1024, setts[1].offset);
console.log(`Detail record [0x${ds.toString(16)}..0x${de.toString(16)}):`);
const slice0 = buf.slice(ds, de);
// Print hex with ASCII at 16 bytes/line
for (let off = 0; off < slice0.length; off += 16) {
  const a = ds + off;
  const chunk = slice0.slice(off, off + 16);
  const hex = chunk.toString("hex").match(/.{2}/g).join(" ");
  const asc = Array.from(chunk).map(c => c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : ".").join("");
  console.log(`  0x${a.toString(16).padStart(8,"0")}: ${hex}  ${asc}`);
}
