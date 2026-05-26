// dig-diploenum-zonecheck.js — debug: list all zones per faction & att-5 presence.
"use strict";
const fs = require("fs");
const SAVE_DEFAULT =
  "C:/Users/vtarn/AppData/Local/Feral Interactive/Total War ROME REMASTERED/VFS/Local/Rome/saves/save_Seleucids t0.sav";
const DESCR_SM_FACTIONS = "C:/RIS/RIS/data/descr_sm_factions.txt";
const savePath = process.argv[2] || SAVE_DEFAULT;
const MARKER = 0x39240005;

function parseFactionOrder(text) {
  const lines = text.split(/\r?\n/);
  const order = [];
  let currentFaction = null, braceDepth = 0, wasInBlock = false;
  for (const raw of lines) {
    const s = raw.trim();
    if (s.startsWith(";")) continue;
    const prevDepth = braceDepth;
    for (const ch of s) { if (ch === "{") braceDepth++; if (ch === "}") braceDepth--; }
    if (wasInBlock && braceDepth === 0) { currentFaction = null; wasInBlock = false; }
    if (prevDepth === 0 && braceDepth === 0) {
      const fm = s.match(/^"([^"]+)"\s*:/);
      if (fm) { const name = fm[1].toLowerCase(); if (name !== "factions") currentFaction = name; }
    }
    if (currentFaction && prevDepth === 0 && braceDepth === 1) {
      wasInBlock = true;
      if (!order.includes(currentFaction)) order.push(currentFaction);
    }
  }
  return order;
}

const buf = fs.readFileSync(savePath);
const factionOrder = parseFactionOrder(fs.readFileSync(DESCR_SM_FACTIONS, "utf8"));
const all = [];
for (let i = 53; i + 8 < buf.length; i += 1) {
  if (buf.readUInt32LE(i) !== MARKER) continue;
  const count = buf.readUInt32LE(i + 4);
  if (count === 0 || count > 200) continue;
  const fid = buf[i - 53];
  if (fid >= factionOrder.length) continue;
  const name = factionOrder[fid];
  if (!name) continue;
  let ok = true; const atts = new Set(); const clss = new Set();
  for (let k = 0; k < count; k++) {
    const o = i + 8 + k * 16;
    if (o + 16 > buf.length) { ok = false; break; }
    atts.add(buf.readUInt32LE(o + 8)); clss.add(buf.readUInt32LE(o + 4));
  }
  if (!ok) continue;
  all.push({ off: i, fid, name, count, hasAtt5: atts.has(5), atts: [...atts].sort(), clss: [...clss].sort() });
}

// Which zones have att5?
const att5 = all.filter((z) => z.hasAtt5);
console.log(`TOTAL zones: ${all.length}`);
console.log(`zones with att==5: ${att5.length}`);
for (const z of att5) console.log(`  @${z.off.toString(16)} fid=${z.fid} ${z.name} count=${z.count} atts=[${z.atts}] clss=[${z.clss}]`);

// Seleucid specifically
console.log("\nAll 'seleucid' zones:");
for (const z of all.filter((z) => z.name === "seleucid")) {
  console.log(`  @${z.off.toString(16)} count=${z.count} hasAtt5=${z.hasAtt5} atts=[${z.atts}] clss=[${z.clss}]`);
}

// Distribution of max-att per zone
const maxAttHist = {};
for (const z of all) { const m = Math.max(...z.atts); maxAttHist[m] = (maxAttHist[m] || 0) + 1; }
console.log("\nmax-attitude-per-zone histogram:", maxAttHist);
