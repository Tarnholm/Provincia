// dig-diploterms-19-playerclass.js
// Collect player-perspective (tag=0) zone class distributions across MANY saves
// to enumerate which class values occur and how often. The player zone uses
// attitude=5 always and class to encode agreement type. Trade proved 5->2.
// Look for class 0,1,4 occurrences and the saves they appear in.
"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const MARKER = 0x39240005;

function allZones(buf) {
  const zones = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), class_: buf.readUInt32LE(o + 4), attitude: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (!ok) continue;
    zones.push({ markerOff: i, count, entries });
  }
  return zones;
}
function playerZone(buf) {
  const zs = allZones(buf);
  // player zone = the one whose entries are ALL tag=0
  const cand = zs.filter(z => z.entries.length && z.entries.every(e => e.tag === 0));
  // pick the largest such zone
  cand.sort((a,b)=>b.count-a.count);
  return cand[0] || null;
}

// All save files
const files = fs.readdirSync(SAVE_DIR).filter(f => f.endsWith(".sav"));
for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(path.join(SAVE_DIR, f)); } catch { continue; }
  const z = playerZone(buf);
  if (!z) { continue; }
  // class distribution + attitude distribution
  const cls = {}, att = {};
  for (const e of z.entries) { cls[e.class_]=(cls[e.class_]||0)+1; att[e.attitude]=(att[e.attitude]||0)+1; }
  // only print if there's a non-5 class (interesting agreement) or att != 5
  const nonFive = z.entries.some(e => e.class_ !== 5);
  const attNon5 = z.entries.some(e => e.attitude !== 5);
  const flag = nonFive ? " <-- has agreements" : "";
  console.log(`${f.slice(0,55).padEnd(55)} cnt=${String(z.count).padStart(3)} cls=${JSON.stringify(cls)} att=${JSON.stringify(att)}${flag}`);
}
