// dig-warhunt-spain-zones.js
// Anchored (not absolute) view of Spain saves. Use parseAllFactionDiplomacy's
// marker-53 logic to get every faction's zone, then for Spain(18) and
// Carthage(7) dump the zone entries across all saves to see what changes on
// declaring war. Vanilla faction order.
"use strict";
const fs = require("fs");
const STEAM_FACTIONS = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Total War ROME REMASTERED\\Contents\\Resources\\Data\\data\\descr_sm_factions.txt";
const SAVES_DIR = "C:\\Users\\vtarn\\AppData\\Local\\Feral Interactive\\Total War ROME REMASTERED\\VFS\\Local\\Rome\\saves\\";

function loadFactionOrder(path) {
  const txt = fs.readFileSync(path, "utf8"); const order = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    const fm = line.match(/^\s*"([a-z_0-9]+)":\s*(;.*)?$/);
    if (fm) { cur = fm[1]; continue; }
    if (cur) { const cm = line.match(/^\s*"culture":\s*"([a-z_]+)"/); if (cm) { order.push(cur); cur = null; } }
  }
  return order;
}
let order = loadFactionOrder(STEAM_FACTIONS);
console.log(`vanilla faction order (${order.length}):`, order.map((f,i)=>`${i}:${f}`).join(" "));

const ALL = [
  ["T2-trade", "save_Autosave   Spain   Turn 2 trade offer to carthage, accepted..sav"],
  ["T3End-PRE", "save_Autosave   Spain   Turn 3 End.sav"],
  ["T4Start-PRE", "save_Autosave   Spain   Turn 4 Start.sav"],
  ["declareWAR", "save_Autosave   Spain   Turn 4 attack Carthage army (declaring war).sav"],
  ["besieged", "save_Autosave   Spain   Turn 4 besiged .sav"],
  ["T4-WAR", "save_Autosave   Spain   Turn 4.sav"],
];

const MARKER = 0x39240005;
function collectZones(buf, delta) {
  const byFid = new Map();
  for (let i = delta; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count === 0 || count > 200) continue;
    const fid = buf[i - delta];
    if (fid >= order.length) continue;
    const entries = []; let ok = true;
    for (let k = 0; k < count; k++) {
      const o = i + 8 + k * 16;
      if (o + 16 > buf.length) { ok = false; break; }
      entries.push({ uuid: buf.readUInt32LE(o), cls: buf.readUInt32LE(o + 4), att: buf.readUInt32LE(o + 8), tag: buf.readUInt32LE(o + 12) });
    }
    if (!ok) continue;
    if (!byFid.has(fid) || byFid.get(fid).count < count) byFid.set(fid, { fid, off: i, count, entries });
  }
  return byFid;
}

const SPAIN = order.indexOf("spain");
const CARTH = order.indexOf("carthage");
console.log(`\nspain fid=${SPAIN} carthage fid=${CARTH}\n`);

for (const [tag, f] of ALL) {
  let buf; try { buf = fs.readFileSync(SAVES_DIR + f); } catch { console.log(`${tag}: missing`); continue; }
  const z = collectZones(buf, 53);
  const sp = z.get(SPAIN), ca = z.get(CARTH);
  function fmt(zone) {
    if (!zone) return "no-zone";
    const a = { 0:0,1:0,2:0,3:0,4:0 }; const c = { 0:0,1:0,2:0,4:0,oth:0 };
    for (const e of zone.entries) { if (a[e.att]!==undefined) a[e.att]++; if (c[e.cls]!==undefined) c[e.cls]++; else c.oth++; }
    return `cnt=${zone.count} @0x${zone.off.toString(16)} att{${a[0]},${a[1]},${a[2]},${a[3]},${a[4]}} cls{${c[0]},${c[1]},${c[2]},${c[4]},${c.oth}}`;
  }
  console.log(`${tag.padEnd(12)} SPAIN[${fmt(sp)}]  CARTH[${fmt(ca)}]  totalZones=${z.size}`);
}
