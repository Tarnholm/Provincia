// dig-diploterms-16-truezone.js
// The tag=0 zone is the PLAYER's perspective. Find it correctly (by tag=0, not
// by -53 owner byte). Track ALL its entries across the full Spain sequence.
// Also determine the correct owner-byte delta for the tag=0 zone.
"use strict";
const fs = require("fs");
const path = require("path");

const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const VANILLA_ORDER = [
  "romans_julii","romans_brutii","romans_scipii","romans_senate","macedon","egypt",
  "seleucid","carthage","parthia","pontus","gauls","germans","britons","armenia",
  "dacia","greek_cities","numidia","scythia","spain","thrace","slave"];
const MARKER = 0x39240005;

function findAllZones(buf) {
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

// The player zone = the one with tag=0 entries.
function playerZone(buf) {
  const zs = findAllZones(buf);
  return zs.find(z => z.entries.length && z.entries.every(e => e.tag === 0)) ||
         zs.find(z => z.entries.some(e => e.tag === 0));
}

const seq = [
  ["T1", "save_17-05-2026   Spain   Turn 1.sav"],
  ["T1move", "save_17-05-2026   Spain   Turn 1move diplomat and army.sav"],
  ["T2trade", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3spy", "save_Autosave   Spain   Turn 3 inflitrated city with spy..sav"],
  ["T3end", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4start", "save_Autosave   Spain   Turn 4 Start.sav"],
  ["T4war", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["T4", "save_Autosave   Spain   Turn 4.sav"],
  ["T4besieged", "save_Autosave   Spain   Turn 4 besiged .sav"],
  ["T4besiegedCorduba", "save_Autosave   Spain   Turn 4 besiged corduba.sav"],
];

console.log("=== TRUE player(spain) perspective zone (tag=0) across sequence ===");
let prev = null;
for (const [label, f] of seq) {
  if (!fs.existsSync(path.join(SAVE_DIR, f))) { console.log(`  ${label}: MISSING`); continue; }
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  const z = playerZone(buf);
  const cur = new Map(z.entries.map(e => [e.uuid, e]));
  const s = z.entries.map(e=>`${e.uuid}[c${e.class_}a${e.attitude}]`).join(" ");
  console.log(`  ${label.padEnd(18)} cnt=${z.count}: ${s}`);
  if (prev) {
    for (const [u, e] of cur) {
      const p = prev.get(u);
      if (!p) console.log(`        +ADD ${u} c${e.class_}a${e.attitude}`);
      else if (p.class_ !== e.class_ || p.attitude !== e.attitude) console.log(`        ~CHG ${u}: c${p.class_}->${e.class_} a${p.attitude}->${e.attitude}`);
    }
    for (const [u, e] of prev) if (!cur.has(u)) console.log(`        -DEL ${u}`);
  }
  prev = cur;
}
