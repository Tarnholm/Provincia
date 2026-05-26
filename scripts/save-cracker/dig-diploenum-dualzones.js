// dig-diploenum-dualzones.js
//
// Discovery: each faction may have MULTIPLE 0x39240005 zones. The att==5 one
// is special (player-template?). List EVERY zone per faction (no dedup) for
// a handful of factions, with class+att histograms, to see whether the
// "real" live diplomacy is a different zone than the att5 one.
//
// Usage: node dig-diploenum-dualzones.js [savePath] [faction1,faction2,...]

"use strict";
const fs = require("fs");
const path = require("path");
const SAVE_DEFAULT =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav";
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const savePath = process.argv[2] || SAVE_DEFAULT;
const focus = (process.argv[3] || "seleucid,antigonid,romans_julii,ptolemaic,carthage").split(",");
const MARKER = 0x39240005;

function parseFactionOrder(text) {
  const order = []; let cur = null, depth = 0, inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const s = raw.trim(); if (s.startsWith(";")) continue;
    const prev = depth; for (const ch of s) { if (ch === "{") depth++; if (ch === "}") depth--; }
    if (inBlock && depth === 0) { cur = null; inBlock = false; }
    if (prev === 0 && depth === 0) { const m = s.match(/^"([^"]+)"\s*:/); if (m && m[1].toLowerCase() !== "factions") cur = m[1].toLowerCase(); }
    if (cur && prev === 0 && depth === 1) { inBlock = true; if (!order.includes(cur)) order.push(cur); }
  }
  return order;
}

const buf = fs.readFileSync(savePath);
const fo = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));

// Collect ALL zones (no dedup).
const all = [];
for (let i = 53; i + 8 < buf.length; i++) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4); if (count === 0 || count > 200) continue;
  const fid = buf[i - 53]; if (fid >= fo.length) continue; const name = fo[fid]; if (!name) continue;
  let ok = true; const clsH = {}, attH = {}, caH = {};
  for (let k = 0; k < count; k++) {
    const o = i + 8 + k * 16; if (o + 16 > buf.length) { ok = false; break; }
    const cls = buf.readUInt32LE(o + 4), att = buf.readUInt32LE(o + 8);
    clsH[cls] = (clsH[cls] || 0) + 1; attH[att] = (attH[att] || 0) + 1;
    caH[`${cls}/${att}`] = (caH[`${cls}/${att}`] || 0) + 1;
  }
  if (!ok) continue;
  all.push({ off: i, fid, name, count, clsH, attH, caH, hasAtt5: !!attH[5] });
}

console.log(`SAVE: ${path.basename(savePath)}   total zones=${all.length}`);

// How many factions have >1 zone?
const byName = {};
for (const z of all) { (byName[z.name] = byName[z.name] || []).push(z); }
const multi = Object.entries(byName).filter(([, v]) => v.length > 1);
console.log(`factions with >1 zone: ${multi.length}`);
console.log(`factions with att5 zone: ${all.filter((z) => z.hasAtt5).length}`);
console.log("");

for (const name of focus) {
  const zs = byName[name] || [];
  console.log(`### ${name}: ${zs.length} zone(s)`);
  for (const z of zs) {
    console.log(`   @${z.off.toString(16)} count=${z.count} att5=${z.hasAtt5}`);
    console.log(`      class: ${JSON.stringify(z.clsH)}`);
    console.log(`      att:   ${JSON.stringify(z.attH)}`);
    console.log(`      c/a:   ${JSON.stringify(z.caH)}`);
  }
  console.log("");
}
