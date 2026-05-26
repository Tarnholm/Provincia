// dig-diploterms-03-allzonediff.js
// Full diff of ALL diplomacy zones between two saves: which zone, which entry,
// what changed. Match zones by ownerFid, entries by relationUuid.
"use strict";
const fs = require("fs");
const path = require("path");

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
        uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o + 4),
        attitude: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12),
      });
    }
    if (!ok) continue;
    zones.push({ markerOff: i, ownerFid: fid, count, entries });
  }
  const byOwner = new Map();
  for (const z of zones) {
    if (!byOwner.has(z.ownerFid) || byOwner.get(z.ownerFid).count < z.count) byOwner.set(z.ownerFid, z);
  }
  return byOwner;
}

function fname(n) { return VANILLA_ORDER[n] || `#${n}`; }

function diffAll(label, fa, fb) {
  const A = findZones(fs.readFileSync(path.join(SAVE_DIR, fa)));
  const B = findZones(fs.readFileSync(path.join(SAVE_DIR, fb)));
  console.log(`\n========== ${label} ==========`);
  const allFids = new Set([...A.keys(), ...B.keys()]);
  for (const fid of [...allFids].sort((x, y) => x - y)) {
    const za = A.get(fid), zb = B.get(fid);
    const a = new Map((za ? za.entries : []).map(e => [e.uuid, e]));
    const b = new Map((zb ? zb.entries : []).map(e => [e.uuid, e]));
    const lines = [];
    for (const [uuid, eb] of b) {
      const ea = a.get(uuid);
      if (!ea) lines.push(`     +ADD uuid=${uuid} cls=${eb.class_} att=${eb.attitude} tag=0x${eb.tag.toString(16)}`);
      else if (ea.class_ !== eb.class_ || ea.attitude !== eb.attitude || ea.tag !== eb.tag)
        lines.push(`     ~CHG uuid=${uuid}: cls ${ea.class_}->${eb.class_}  att ${ea.attitude}->${eb.attitude}  tag 0x${ea.tag.toString(16)}->0x${eb.tag.toString(16)}`);
    }
    for (const [uuid, ea] of a) if (!b.has(uuid)) lines.push(`     -DEL uuid=${uuid} cls=${ea.class_} att=${ea.attitude}`);
    if (lines.length) {
      console.log(`  ZONE fid=${fid} (${fname(fid)})  countA=${za ? za.count : "-"} countB=${zb ? zb.count : "-"}`);
      lines.forEach(l => console.log(l));
    }
  }
}

diffAll("T1base -> T2trade (TRADE w/ carthage)",
  "save_17-05-2026   Spain   Turn 1.sav",
  "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav");

diffAll("T4start -> T4war (WAR on carthage)",
  "save_Autosave   Spain   Turn 4 Start.sav",
  "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav");

// also war -> end-of-turn-4 to catch late update
diffAll("T4war -> T4 (post-war same turn)",
  "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav",
  "save_Autosave   Spain   Turn 4.sav");
