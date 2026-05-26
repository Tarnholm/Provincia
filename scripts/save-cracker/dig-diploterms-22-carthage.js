// dig-diploterms-22-carthage.js
// Verify class-4 = locked/protectorate using Carthage-player save. Count RIS
// carthage descr_strat allies/wars/locked. Compare to player-zone {2:24,4:7,5:10}.
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
    for (let k = 0; k < count; k++) { const o=i+8+k*16; if(o+16>buf.length){ok=false;break;} entries.push({class_:buf.readUInt32LE(o+4),tag:buf.readUInt32LE(o+12)}); }
    if (!ok) continue;
    zs.push({count, entries});
  }
  const cand = zs.filter(z=>z.entries.length&&z.entries.every(e=>e.tag===0)).sort((a,b)=>b.count-a.count);
  return cand[0];
}
function clsHist(z){const h={};for(const e of z.entries)h[e.class_]=(h[e.class_]||0)+1;return h;}

const rels = relsFor("carthage");
const ally = rels.filter(r=>r.val<=199);
const war = rels.filter(r=>r.val>=201);
const locked = lockedFor("carthage");
const buf = fs.readFileSync(path.join(SAVE_DIR, "save_Autosave   Carthage   Turn 1 End.sav"));
const z = playerZone(buf);
console.log(`Carthage descr_strat: ally+trade(<=199)=${ally.length} [${ally.map(r=>r.partner).join(",")}]`);
console.log(`  war(>=201)=${war.length} [${war.map(r=>r.partner).join(",")}]`);
console.log(`  locked(-10)=${locked.length} [${locked.join(",")}]`);
console.log(`Carthage player-zone (T1End) class histogram: ${JSON.stringify(clsHist(z))} total=${z.count}`);
console.log(`\nNote: T1End is mid-game (carthage may have made deals/wars in its first turn),`);
console.log(`so exact match not expected; but class-4 count vs locked count is the test.`);
