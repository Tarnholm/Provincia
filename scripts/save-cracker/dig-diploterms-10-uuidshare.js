// dig-diploterms-10-uuidshare.js
// Test whether a relationUuid is SHARED between two factions' zones (symmetric
// relation). If so, we can recover the partner pairing from uuid co-occurrence.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii","romans_brutii","romans_scipii","romans_senate","macedon","egypt",
  "seleucid","carthage","parthia","pontus","gauls","germans","britons","armenia",
  "dacia","greek_cities","numidia","scythia","spain","thrace","slave"];
const MARKER = 0x39240005;

function findZones(buf) {
  const zones = [];
  const seen = new Map();
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
      entries.push({ uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o + 4), attitude: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (!ok) continue;
    if (!seen.has(fid) || seen.get(fid).count < count) seen.set(fid, { fid, markerOff: i, count, entries });
  }
  return [...seen.values()];
}

const buf = fs.readFileSync(path.join(SAVE_DIR, "save_17-05-2026   Spain   Turn 1.sav"));
const zones = findZones(buf);

// Map uuid -> [ {fid, class, att}, ... ]
const byUuid = new Map();
for (const z of zones) {
  for (const e of z.entries) {
    if (!byUuid.has(e.uuid)) byUuid.set(e.uuid, []);
    byUuid.get(e.uuid).push({ fid: z.fid, fname: VANILLA_ORDER[z.fid], class_: e.class_, att: e.attitude, tag: e.tag });
  }
}

// How many uuids appear in 1, 2, 3+ zones?
const hist = {};
for (const [u, arr] of byUuid) hist[arr.length] = (hist[arr.length] || 0) + 1;
console.log("uuid occurrence histogram (#zones it appears in : #uuids):", JSON.stringify(hist));

// Show the SHARED uuids (appear in exactly 2 zones) -> the partner pairing!
console.log("\n=== SHARED relation uuids (appear in 2 zones = partner pair) ===");
let shared = 0;
for (const [u, arr] of [...byUuid].sort((a,b)=>a[0]-b[0])) {
  if (arr.length === 2) {
    shared++;
    const [x, y] = arr;
    console.log(`  uuid=${u}: ${x.fname}[c${x.class_}a${x.att}] <-> ${y.fname}[c${y.class_}a${y.att}]`);
  }
}
console.log(`(${shared} shared pairs)`);

// uuids appearing only once (player's own zone padding likely)
console.log("\n=== uuids in only ONE zone ===");
for (const [u, arr] of [...byUuid].sort((a,b)=>a[0]-b[0])) {
  if (arr.length === 1) {
    const x = arr[0];
    console.log(`  uuid=${u}: ${x.fname}[c${x.class_}a${x.att}t${x.tag.toString(16)}] (solo)`);
  }
}
