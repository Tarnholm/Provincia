// dig-diploterms-04-rawzones.js
// Dump ALL raw zones (no dedup) and look for ANY entry change anywhere across
// war transition, including count changes and zones whose ownerFid is unusual.
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

function findAllZones(buf) {
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
  return zones;
}

function sig(z) {
  // signature independent of marker offset: owner + sorted entry tuples
  const es = z.entries.map(e => `${e.uuid}:${e.class_}:${e.attitude}:${e.tag}`).sort().join(",");
  return `${z.ownerFid}|${z.count}|${es}`;
}

const fa = "save_Autosave   Spain   Turn 4 Start.sav";
const fb = "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav";
const A = findAllZones(fs.readFileSync(path.join(SAVE_DIR, fa)));
const B = findAllZones(fs.readFileSync(path.join(SAVE_DIR, fb)));

console.log(`A zones=${A.length}  B zones=${B.length}`);

// Build multisets of signatures
const sigA = new Map(), sigB = new Map();
for (const z of A) sigA.set(sig(z), (sigA.get(sig(z)) || 0) + 1);
for (const z of B) sigB.set(sig(z), (sigB.get(sig(z)) || 0) + 1);

console.log("\n-- signatures only in B (new/changed zones after war) --");
for (const [s, n] of sigB) {
  const a = sigA.get(s) || 0;
  if (n > a) console.log(`  x${n - a}: ${s}`);
}
console.log("\n-- signatures only in A (gone after war) --");
for (const [s, n] of sigA) {
  const b = sigB.get(s) || 0;
  if (n > b) console.log(`  x${n - b}: ${s}`);
}

// Also: list owner fids that appear and how many zones each has
function ownerHist(zs, label) {
  const h = {};
  for (const z of zs) h[z.ownerFid] = (h[z.ownerFid] || 0) + 1;
  console.log(`\n${label} owner histogram (fid: zoneCount):`);
  for (const k of Object.keys(h).sort((a,b)=>a-b)) console.log(`  fid ${k} (${VANILLA_ORDER[k]||"?"}): ${h[k]}`);
}
ownerHist(A, "A");
