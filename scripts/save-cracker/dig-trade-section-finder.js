// dig-trade-section-finder.js
// The save body uses [u32 offset==pos][u32 size] "taw" section framing per
// memory reference_save_cracker. Section TYPE comes from the registry order
// (the body section instances reference type by an index, OR sections appear
// as inline named blocks). Here we just locate every occurrence of the
// resource/trade-related ASCII type names as inline strings in the body and
// dump their surroundings, since RR sometimes inlines the type name.
"use strict";
const fs = require("fs");
const SAVE = process.argv[2] || "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_17-05-2026   Spain   Turn 1.sav";
const buf = fs.readFileSync(SAVE);

const NAMES = ["RESOURCE_MANAGER", "RESOURCE_HEADER", "RESOURCE_ID", "ECONOMICS_DATA", "MAKE_TRADE_AGREEMENT_BUILDER", "PORT_MANAGER", "ROAD_MANAGER", "SETTLEMENT_MECHANICS_STATS"];
for (const name of NAMES) {
  const t = Buffer.from(name, "ascii");
  let p = 0; const hits = [];
  while ((p = buf.indexOf(t, p)) !== -1) { hits.push(p); p += 1; if (hits.length > 30) break; }
  console.log(name, "occurrences:", hits.length, hits.slice(0, 8).map(h => "0x" + h.toString(16)).join(" "));
}

// Dump around the first RESOURCE_MANAGER occurrence in the body (skip registry copy)
function hexWin(start, len, label) {
  console.log(`\n--- ${label} @0x${start.toString(16)} ---`);
  let out = "";
  for (let i = start; i < start + len && i < buf.length; i += 16) {
    const slab = buf.slice(i, i + 16);
    const h = [...slab].map(b => b.toString(16).padStart(2, "0")).join(" ");
    const a = [...slab].map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : ".").join("");
    out += i.toString(16).padStart(6, "0") + "  " + h.padEnd(48) + "  " + a + "\n";
  }
  console.log(out);
}
function bodyHits(name) {
  const t = Buffer.from(name, "ascii");
  let p = 0; const hits = [];
  while ((p = buf.indexOf(t, p)) !== -1) { hits.push(p); p += 1; }
  // skip the registry copy (offset < 0x2000)
  return hits.filter(h => h > 0x2000);
}
const rm = bodyHits("RESOURCE_MANAGER");
if (rm.length) hexWin(rm[0] - 64, 192, "RESOURCE_MANAGER body");
const eco = bodyHits("ECONOMICS_DATA");
if (eco.length) hexWin(eco[0] - 64, 192, "ECONOMICS_DATA body");
const mta = bodyHits("MAKE_TRADE_AGREEMENT_BUILDER");
if (mta.length) hexWin(mta[0] - 32, 160, "MAKE_TRADE_AGREEMENT_BUILDER body");
