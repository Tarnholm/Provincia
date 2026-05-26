// dig-diploterms-08-warlater.js
// Check the besieged saves (clearly post-war) for any zone change vs T4start.
// Also include all later-turn saves to see if war ever shows up in zones.
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
  const zones = new Map();
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
    if (!zones.has(fid) || zones.get(fid).count < count) zones.set(fid, { markerOff: i, count, entries });
  }
  return zones;
}

const files = [
  ["T4start","save_Autosave   Spain   Turn 4 Start.sav"],
  ["T4war","save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["T4","save_Autosave   Spain   Turn 4.sav"],
  ["T4besieged","save_Autosave   Spain   Turn 4 besiged .sav"],
  ["T4besiegedCorduba","save_Autosave   Spain   Turn 4 besiged corduba.sav"],
];

console.log("=== SPAIN(18) & CARTHAGE(7) zone across post-war saves ===");
for (const [label, f] of files) {
  if (!fs.existsSync(path.join(SAVE_DIR, f))) { console.log(`  ${label}: MISSING`); continue; }
  const z = findZones(fs.readFileSync(path.join(SAVE_DIR, f)));
  const sp = z.get(18), ca = z.get(7);
  console.log(`  ${label}`);
  console.log(`    SPAIN: ${sp.entries.map(e=>`${e.uuid}[c${e.class_}a${e.attitude}t${e.tag.toString(16)}]`).join(" ")}`);
  console.log(`    CARTH: ${ca.entries.map(e=>`${e.uuid}[c${e.class_}a${e.attitude}t${e.tag.toString(16)}]`).join(" ")}`);
}

// Full all-zone diff: T4start vs besiged corduba
function diffAll(label, fa, fb) {
  const A = findZones(fs.readFileSync(path.join(SAVE_DIR, fa)));
  const B = findZones(fs.readFileSync(path.join(SAVE_DIR, fb)));
  console.log(`\n=== ALL-ZONE DIFF ${label} ===`);
  const fids = new Set([...A.keys(),...B.keys()]);
  for (const fid of [...fids].sort((x,y)=>x-y)) {
    const za=A.get(fid), zb=B.get(fid);
    const a=new Map((za?za.entries:[]).map(e=>[e.uuid,e]));
    const b=new Map((zb?zb.entries:[]).map(e=>[e.uuid,e]));
    const lines=[];
    for (const [u,eb] of b){const ea=a.get(u);
      if(!ea)lines.push(`     +ADD u=${u} c${eb.class_} a${eb.attitude} t${eb.tag.toString(16)}`);
      else if(ea.class_!==eb.class_||ea.attitude!==eb.attitude||ea.tag!==eb.tag)lines.push(`     ~CHG u=${u}: c${ea.class_}->${eb.class_} a${ea.attitude}->${eb.attitude} t${ea.tag.toString(16)}->${eb.tag.toString(16)}`);}
    for (const [u,ea] of a) if(!b.has(u)) lines.push(`     -DEL u=${u} c${ea.class_} a${ea.attitude}`);
    if(lines.length){console.log(`  fid=${fid}(${VANILLA_ORDER[fid]}) cA=${za?za.count:"-"} cB=${zb?zb.count:"-"}`); lines.forEach(l=>console.log(l));}
  }
}
diffAll("T4start -> T4besiegedCorduba", "save_Autosave   Spain   Turn 4 Start.sav", "save_Autosave   Spain   Turn 4 besiged corduba.sav");
