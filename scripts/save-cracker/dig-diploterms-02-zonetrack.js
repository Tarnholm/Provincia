// dig-diploterms-02-zonetrack.js
// Track Spain (fid 18) and Carthage (fid 7) zones entry-by-entry across saves.
// Match entries by relationUuid so we can see which class/attitude flips.
"use strict";
const fs = require("fs");
const path = require("path");
const X = require("C:/dev/Provincia/src/saveCrackerExtras.js");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii", "romans_brutii", "romans_scipii", "romans_senate",
  "macedon", "egypt", "seleucid", "carthage", "parthia", "pontus",
  "gauls", "germans", "britons", "armenia", "dacia",
  "greek_cities", "numidia", "scythia", "spain", "thrace", "slave",
];
const MARKER = 0x39240005;

function findZones(buf) {
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
      entries.push({
        uuid: buf.readUInt32LE(o),
        class_: buf.readUInt32LE(o + 4),
        attitude: buf.readUInt32LE(o + 8),
        tag: buf.readUInt32LE(o + 12),
        entryOff: o,
      });
    }
    if (!ok) continue;
    zones.push({ markerOff: i, ownerFid: fid, count, entries });
  }
  // dedup by owner keep highest count
  const byOwner = new Map();
  for (const z of zones) {
    if (!byOwner.has(z.ownerFid) || byOwner.get(z.ownerFid).count < z.count) byOwner.set(z.ownerFid, z);
  }
  return byOwner;
}

function load(fname) {
  const buf = fs.readFileSync(path.join(SAVE_DIR, fname));
  return { buf, zones: findZones(buf) };
}

const SPAIN = 18, CARTH = 7;

function dumpZone(label, byOwner, fid) {
  const z = byOwner.get(fid);
  if (!z) { console.log(`  ${label} fid=${fid}: NO ZONE`); return null; }
  console.log(`  ${label} fid=${fid} (${VANILLA_ORDER[fid]}) markerOff=0x${z.markerOff.toString(16)} count=${z.count}`);
  for (const e of z.entries) {
    console.log(`     uuid=${e.uuid} cls=${e.class_} att=${e.attitude} tag=0x${e.tag.toString(16)}`);
  }
  return z;
}

function diffZone(name, zA, zB) {
  console.log(`\n  --- DIFF ${name} ---`);
  const a = new Map((zA ? zA.entries : []).map(e => [e.uuid, e]));
  const b = new Map((zB ? zB.entries : []).map(e => [e.uuid, e]));
  // changed / added
  for (const [uuid, eb] of b) {
    const ea = a.get(uuid);
    if (!ea) {
      console.log(`     ADDED uuid=${uuid} cls=${eb.class_} att=${eb.attitude} tag=0x${eb.tag.toString(16)}`);
    } else if (ea.class_ !== eb.class_ || ea.attitude !== eb.attitude || ea.tag !== eb.tag) {
      console.log(`     CHANGED uuid=${uuid}: cls ${ea.class_}->${eb.class_}  att ${ea.attitude}->${eb.attitude}  tag 0x${ea.tag.toString(16)}->0x${eb.tag.toString(16)}`);
    }
  }
  for (const [uuid, ea] of a) {
    if (!b.has(uuid)) console.log(`     REMOVED uuid=${uuid} cls=${ea.class_} att=${ea.attitude}`);
  }
}

const transitions = [
  ["T1base -> T2trade (TRADE accepted w/ carthage)", "save_17-05-2026   Spain   Turn 1.sav", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T4start -> T4war (WAR declared on carthage)", "save_Autosave   Spain   Turn 4 Start.sav", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
];

for (const [label, fa, fb] of transitions) {
  console.log(`\n========== ${label} ==========`);
  const A = load(fa), B = load(fb);
  console.log(" BEFORE:");
  const aSpain = dumpZone("SPAIN", A.zones, SPAIN);
  const aCarth = dumpZone("CARTH", A.zones, CARTH);
  console.log(" AFTER:");
  const bSpain = dumpZone("SPAIN", B.zones, SPAIN);
  const bCarth = dumpZone("CARTH", B.zones, CARTH);
  diffZone("SPAIN zone", aSpain, bSpain);
  diffZone("CARTHAGE zone", aCarth, bCarth);
}
