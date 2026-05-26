// dig-diploterms-07-relrecords.js
// The relationUuid is a global counter. Look for a SEPARATE relation-record
// table keyed by these uuids that holds partner identity + agreement terms.
// Find ALL occurrences of each relationUuid (as u32 LE) in the buffer, outside
// the diplomacy zones, and dump bytes around them.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const MARKER = 0x39240005;

function loadZones(buf) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const fid = buf[i - 53];
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), off: o });
    }
    if (!ok) continue;
    zones.push({ markerOff: i, ownerFid: fid, count, entries, zoneStart: i, zoneEnd: i + 8 + count * 16 });
  }
  return zones;
}

const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const zones = loadZones(buf);

// region of all zone markers (to exclude from search)
const zoneRanges = zones.map(z => [z.markerOff - 60, z.zoneEnd]);
function inZone(off) { return zoneRanges.some(([a, b]) => off >= a && off < b); }

// The relation uuids of interest (spain + carthage):
const targets = [40, 52, 62, 50, 87, 81, 93, 54, 70, 66, 45];

for (const uuid of targets) {
  const tb = Buffer.alloc(4); tb.writeUInt32LE(uuid);
  const hits = [];
  let p = 0;
  while ((p = buf.indexOf(tb, p)) !== -1) {
    hits.push(p);
    p += 1;
  }
  const outside = hits.filter(h => !inZone(h));
  console.log(`uuid=${uuid}: total hits=${hits.length} outsideZones=${outside.length}`);
  // Show first few outside-zone hits with context
  for (const h of outside.slice(0, 6)) {
    const ctx = [];
    for (let i = -8; i < 16; i++) {
      if (h + i < 0 || h + i >= buf.length) continue;
      ctx.push((h + i === h ? "[" : "") + buf[h + i].toString(16).padStart(2, "0") + (h + i === h + 3 ? "]" : ""));
    }
    console.log(`    @0x${h.toString(16)}: ${ctx.join(" ")}`);
  }
}
