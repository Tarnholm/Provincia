// dig-diploterms-21-verify.js
// Verify class meanings across multiple RIS factions. For seleucid list -10
// locked partners. For antigonid/macedon count ally/trade/war and compare to
// player-zone class histogram. Player faction id is detected from save.
"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DIR = "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves";
const ds = fs.readFileSync("C:/RIS/RIS/data/world/maps/campaign/imperial_campaign/descr_strat.txt", "latin1");
const lines = ds.split(/\r?\n/);
const MARKER = 0x39240005;

function relsFor(faction) {
  const out = [];
  const re = new RegExp(`^\\s*faction_relationships\\s+${faction}\\s*,\\s*(\\d+)\\s+(\\w+)`, "i");
  for (const ln of lines) { const code = ln.split(";")[0]; const m = re.exec(code); if (m) out.push({ val:+m[1], partner:m[2].toLowerCase() }); }
  return out;
}
function lockedFor(faction) {
  const out = [];
  const re = new RegExp(`^\\s*core_attitudes\\s+${faction}\\s*,\\s*(-?\\d+)\\s+(.+)$`, "i");
  for (const ln of lines) { const code = ln.split(";")[0]; const m = re.exec(code); if (m && +m[1]===-10) { m[2].split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).forEach(p=>out.push(p)); } }
  return out;
}
function playerZone(buf) {
  const zs = [];
  for (let i = 53; i + 8 < buf.length; i++) {
    if (buf.readUInt32LE(i) !== MARKER) continue;
    const count = buf.readUInt32LE(i + 4);
    if (count > 250) continue;
    const entries = [];
    let ok = true;
    for (let k = 0; k < count; k++) { const o=i+8+k*16; if(o+16>buf.length){ok=false;break;} entries.push({class_:buf.readUInt32LE(o+4),attitude:buf.readUInt32LE(o+8),tag:buf.readUInt32LE(o+12)}); }
    if (!ok) continue;
    zs.push({count, entries});
  }
  const cand = zs.filter(z=>z.entries.length&&z.entries.every(e=>e.tag===0)).sort((a,b)=>b.count-a.count);
  return cand[0];
}
function clsHist(z){const h={};for(const e of z.entries)h[e.class_]=(h[e.class_]||0)+1;return h;}

const tests = [
  ["seleucid", "save_Seleucids t0.sav"],
  ["macedon", "save_macedon t0.sav"],
  ["antigonid", "save_Autosave   Antigonid Kingdom   Turn 1.sav"],
];

for (const [faction, f] of tests) {
  const rels = relsFor(faction);
  const ally = rels.filter(r=>r.val<=199);
  const war = rels.filter(r=>r.val>=201);
  const locked = lockedFor(faction);
  const buf = fs.readFileSync(path.join(SAVE_DIR, f));
  const z = playerZone(buf);
  console.log(`\n=== ${faction} (${f}) ===`);
  console.log(`  descr_strat: ally+trade(<=199)=${ally.length}  war(>=201)=${war.length}  locked(-10 core_attitude)=${locked.length} [${locked.join(",")}]`);
  console.log(`  ally partners: ${ally.map(r=>r.partner).join(", ")}`);
  console.log(`  player-zone class histogram: ${JSON.stringify(clsHist(z))} (total ${z.count})`);
}
